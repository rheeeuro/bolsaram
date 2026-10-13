-- 0067: 주선자 정지 · 모임 만들기 요청 알림
--
-- 주선자 가입은 열려 있다. 문제 있는 주선자를 관리자가 막을 수 있게 정지를 둔다.
--
-- user_suspensions
--   정지된 주선자 한 줄. 행이 있으면 정지, 풀면 행을 지운다(경위는 감사 기록에 남는다).
--   관리자만 다루므로 `operator_settings` 와 같이 정책 없이 런타임 롤 권한을 회수한다.
--   막는 자리는 인증 레이어다 — 세션 읽기·새 세션·텔레그램 신원 확인·알림 발송이 모두
--   이 테이블을 본다. 정지는 RLS 컨텍스트가 만들어지기 **전에** 걸린다.
--
--   주선자 계정만 정지한다(멤버는 주선자가 프로필로 다룬다). 관리자는 정지할 수 없다 —
--   관리자를 바꾸는 길은 환경변수다. 둘 다 트리거로 한 번 더 막는다.
--
-- GROUP_CREATION_REQUESTED
--   모임 만들기 승인이 켜져 있을 때 주선자가 요청을 남기면 관리자에게 텔레그램으로
--   알린다. 관리자는 `operator_settings.operator_user_id` 로 DB 가 안다(0065).
--   싣는 것은 요청한 모임 이름뿐이다 — 주선자가 붙인 이름이라 회원 정보가 아니다.

CREATE TABLE user_suspensions (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  suspended_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 관리자만 보는 메모. 정지된 사람에게 보여주지 않는다.
  reason        text CONSTRAINT user_suspensions_reason_len CHECK (char_length(reason) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_suspensions FROM bolsaram_app;

CREATE FUNCTION app_check_suspension_target() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM users WHERE id = NEW.user_id) IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION '주선자 계정만 정지할 수 있습니다.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_id IS NOT DISTINCT FROM (SELECT operator_user_id FROM operator_settings) THEN
    RAISE EXCEPTION '관리자는 정지할 수 없습니다.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_check_suspension_target() FROM PUBLIC;

CREATE TRIGGER user_suspensions_check_target BEFORE INSERT OR UPDATE OF user_id ON user_suspensions
  FOR EACH ROW EXECUTE FUNCTION app_check_suspension_target();

-- ── 모임 만들기 요청 알림 ───────────────────────────────────────

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'GROUP_CREATION_REQUESTED';

-- 방금 추가한 enum 값은 같은 트랜잭션에서 쓸 수 없지만, 함수 본문은 실행할 때 읽히므로
-- 여기서 만들어 두어도 된다(0040 과 같다). 관리자 본인의 요청은 없다 — 바로 만든다.
CREATE FUNCTION notify_group_creation_requested() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  operator_id uuid := (SELECT operator_user_id FROM operator_settings);
BEGIN
  IF NEW.status = 'PENDING'
     AND operator_id IS NOT NULL
     AND operator_id IS DISTINCT FROM NEW.requested_by THEN
    INSERT INTO notifications (kind, recipient_user_id, payload)
    VALUES ('GROUP_CREATION_REQUESTED', operator_id,
            jsonb_build_object('groupName', NEW.name));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notify_group_creation_requested() FROM PUBLIC;

CREATE TRIGGER group_creation_requests_notify AFTER INSERT ON group_creation_requests
  FOR EACH ROW EXECUTE FUNCTION notify_group_creation_requested();
