-- 0017: 알림 아웃박스
--
-- 지금까지 신청이 들어와도 아무도 모른다. 회원은 로그인해야 알고(세션이 만료되면
-- 주선자가 링크를 다시 보내야 한다), 주선자는 /admin/requests 를 열어봐야 안다.
-- 수락된 건은 주선자가 연결해 주지 않으면 거기서 멈추므로, **주선자가 모르면
-- 플로우 전체가 멈춘다.** 이미 붙어 있는 텔레그램 봇으로 알린다.
--
-- ── 왜 아웃박스인가 ───────────────────────────────────────────
-- 알림을 만드는 쪽은 회원이다. 그런데 회원의 RLS 컨텍스트에서는 담당 주선자가
-- 누구인지도, 그 사람의 텔레그램 연결도 읽을 수 없다(정책이 없다). 요청 경로에서
-- owner 커넥션을 쓰는 것은 이 저장소의 규칙이 금지한다.
--
-- 그래서 「보낼 것」만 DB 에 남기고, 보내는 일은 분리한다.
--
--   회원 트랜잭션  →  트리거(SECURITY DEFINER)가 notifications 에 행 추가
--   디스패처       →  owner 로 미발송 행을 집어 텔레그램으로 발송
--
-- 부수 효과가 아니라 이득이다.
--   * 텔레그램이 느리거나 죽어도 「마음 보내기」가 느려지거나 실패하지 않는다.
--   * 전이가 **실제로 성공했을 때만** 알림이 생긴다. 애플리케이션이 알림을 빠뜨리는
--     실수가 구조적으로 불가능하다(조건부 UPDATE 가 0행이면 트리거도 안 돈다).
--   * 발송 실패를 재시도할 수 있다.
--
-- ── 무엇을 싣는가 ─────────────────────────────────────────────
-- payload 에는 **공개 번호(public_code)만** 넣는다. 이름·연락처·프로필 원문·사진은
-- 넣지 않는다. 알림은 「누가 무엇을 했다」가 아니라 「처리할 것이 생겼다」를 알리고,
-- 자세한 내용은 관리자 화면에서 본다. 발송 시점에 프로필을 다시 읽지 않아도 되므로
-- 디스패처가 owner 로 만지는 범위도 이 테이블과 텔레그램 연결로 좁아진다.

CREATE TYPE notification_kind AS ENUM ('MATCH_REQUESTED', 'MATCH_ACCEPTED');

-- 채널은 지금 텔레그램 하나뿐이지만 컬럼으로 둔다. 회원용 채널(이메일 등)이
-- 생기면 수신자 종류가 늘어난다.
CREATE TYPE notification_channel AS ENUM ('TELEGRAM');

CREATE TABLE notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              notification_kind NOT NULL,
  channel           notification_channel NOT NULL DEFAULT 'TELEGRAM',
  -- 받는 사람. 지금은 주선자뿐이다. 계정이 사라지면 알림도 의미가 없다.
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_request_id  uuid REFERENCES match_requests(id) ON DELETE CASCADE,
  -- 공개 번호만. 이름·연락처·원문·사진 URL 은 넣지 않는다.
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  attempts          smallint NOT NULL DEFAULT 0,
  -- 실패 원인은 사람이 읽을 짧은 문장만. 토큰이 든 URL 을 남기지 않는다.
  last_error        text,

  CONSTRAINT notifications_attempts_sane CHECK (attempts >= 0)
);

-- 같은 사건으로 같은 사람에게 두 번 보내지 않는다. 재전송·동시 요청이 있어도
-- 여기서 한 번으로 접힌다(트리거는 ON CONFLICT DO NOTHING 으로 넣는다).
CREATE UNIQUE INDEX notifications_dedupe_idx
  ON notifications (kind, match_request_id, recipient_user_id)
  WHERE match_request_id IS NOT NULL;

-- 디스패처가 매번 읽는 경로. 보낸 것은 인덱스에서 빠진다.
CREATE INDEX notifications_pending_idx
  ON notifications (created_at)
  WHERE sent_at IS NULL;

-- ── 담당 주선자 ───────────────────────────────────────────────
-- app_can_edit_profile 과 같은 규칙이다. 모임 프로필은 그 모임 주선자 전원,
-- 전체공개 프로필은 등록한 사람. 여기서 판정을 다시 쓰는 이유는 그쪽이
-- 「할 수 있는가(boolean)」를 묻고 이쪽은 「누구인가(집합)」를 묻기 때문이다.
CREATE OR REPLACE FUNCTION app_profile_admins(target_profile uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ga.user_id
    FROM profiles p
    JOIN group_admins ga ON ga.group_id = p.group_id
   WHERE p.id = target_profile AND p.group_id IS NOT NULL
  UNION
  SELECT p.created_by
    FROM profiles p
   WHERE p.id = target_profile AND p.group_id IS NULL AND p.created_by IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app_profile_admins(uuid) FROM PUBLIC;

-- ── 트리거 ────────────────────────────────────────────────────
-- SECURITY DEFINER 다 — 회원 컨텍스트에서 돌지만 notifications 와 group_admins 를
-- 읽고 써야 한다. 알림을 만드는 것 외의 일은 하지 않는다.
CREATE OR REPLACE FUNCTION app_enqueue_match_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event_kind notification_kind;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_kind := 'MATCH_REQUESTED';
  ELSIF NEW.status = 'ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED' THEN
    -- 수락된 건은 주선자가 연결해야 다음으로 간다. 가장 급한 알림이다.
    event_kind := 'MATCH_ACCEPTED';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO notifications (kind, recipient_user_id, match_request_id, payload)
  SELECT
    event_kind,
    recipient,
    NEW.id,
    jsonb_build_object(
      'requesterCode', (SELECT public_code FROM profiles WHERE id = NEW.requester_profile_id),
      'targetCode',    (SELECT public_code FROM profiles WHERE id = NEW.target_profile_id)
    )
  FROM (
    -- 양쪽 프로필의 담당자. 같은 풀 안에서만 신청이 생기므로 보통 같은 집합이다.
    SELECT app_profile_admins(NEW.target_profile_id) AS recipient
    UNION
    SELECT app_profile_admins(NEW.requester_profile_id)
  ) admins
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_match_notification() FROM PUBLIC;

CREATE TRIGGER match_requests_notify_created
  AFTER INSERT ON match_requests
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_match_notification();

CREATE TRIGGER match_requests_notify_accepted
  AFTER UPDATE OF status ON match_requests
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_match_notification();

-- ── RLS ───────────────────────────────────────────────────────
-- 쓰기 정책은 주지 않는다. 만드는 것은 위 트리거(owner 소유 SECURITY DEFINER),
-- 보냈다고 표시하는 것은 디스패처(owner)뿐이다. 런타임 롤은 **자기에게 온 알림을
-- 읽는 것만** 할 수 있다 — 나중에 관리자 화면에 알림함을 붙일 자리다.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_read ON notifications FOR SELECT
  USING (recipient_user_id = app_current_user_id() AND app_is_admin());

GRANT SELECT ON notifications TO bolsaram_app;
