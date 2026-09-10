-- 0026: 회원의 의사는 요청이고, 확정은 주선자가 한다
--
-- 볼사람은 주선자가 검증해 등록한 사람만 참여하는 서비스다. 그 성격을 매칭에도
-- 적용한다 — 회원이 누르는 것은 **결정이 아니라 요청**이고, 주선자가 확인해야
-- 실제로 상대에게 전달되거나 연결된다.
--
-- 0021 에서 「수락이 곧 동의이므로 주선자 승인 단계를 두지 않는다」고 정했던 것을
-- 여기서 뒤집는다. 그때는 회원이 자기 폰으로 직접 쓴다고 전제했다. 실제 운영은
-- 다르다 — 등록된 사람이 폰을 쓰지 않는 경우가 정상이고, 주선자가 사이에서 말을
-- 옮긴다. 수락 자체가 본인의 동의라는 사실은 그대로다. 달라지는 것은 **그 동의가
-- 주선자를 거쳐 전달된다**는 점이다.
--
-- ── 왜 상태를 늘리지 않고 테이블을 나눴나 ────────────────────
-- match_requests 에 「주선자 확인 대기」 상태를 더하는 방법도 있었다. 그러면 상대가
-- 그 행을 읽을 수 있는지를 상태마다 정확히 걸어야 하고, 한 곳이라도 틀리면
-- **주선자보다 상대가 먼저 알게 된다.** 수락 대기는 더 위험하다 — 같은 행을 두 사람이
-- 이미 보고 있으므로 컬럼 하나만 새도 새는 것이다(RLS 는 행 단위라 컬럼을 못 가린다).
--
-- 의사를 별도 테이블에 두면 승인 전에는 **상대가 읽을 행 자체가 없다.** 누수가
-- 정책의 정확성이 아니라 구조로 막힌다. match_requests 의 상태 기계·공개 판정·
-- 활성 중복 금지 인덱스는 하나도 건드리지 않는다.

CREATE TYPE match_intent_kind AS ENUM ('SEND', 'ACCEPT', 'REJECT', 'CANCEL');
CREATE TYPE match_intent_status AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

CREATE TABLE match_intents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 의사를 낸 회원. 대행 중이면 주선자가 이 사람을 대신해 낸 것이다.
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind              match_intent_kind NOT NULL,
  -- SEND 는 아직 신청이 없으므로 상대를 직접 가리킨다.
  target_profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  -- 나머지는 기존 신청에 대한 답이다.
  match_request_id  uuid REFERENCES match_requests(id) ON DELETE CASCADE,
  message           text,

  status            match_intent_status NOT NULL DEFAULT 'PENDING',
  decided_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  -- 주선자가 반려한 이유. 회원에게 그대로 보이므로 짧게 쓴다.
  decline_reason    text,

  created_at        timestamptz NOT NULL DEFAULT now(),

  -- 종류에 따라 가리키는 대상이 정확히 하나여야 한다.
  CONSTRAINT match_intents_send_shape
    CHECK ((kind = 'SEND') = (target_profile_id IS NOT NULL)),
  CONSTRAINT match_intents_answer_shape
    CHECK ((kind <> 'SEND') = (match_request_id IS NOT NULL)),
  CONSTRAINT match_intents_no_self
    CHECK (target_profile_id IS NULL OR target_profile_id <> profile_id),
  -- 처리한 사람과 시각은 함께 남거나 함께 비어 있다.
  CONSTRAINT match_intents_decision_pair
    CHECK ((status = 'PENDING') = (decided_at IS NULL))
);

-- 같은 상대에게 확인 대기 중인 요청은 하나만. 연타가 큐를 채우지 않는다.
CREATE UNIQUE INDEX match_intents_one_pending_send
  ON match_intents (profile_id, target_profile_id)
  WHERE status = 'PENDING' AND kind = 'SEND';

-- 한 신청에 대한 답도 하나만. 수락과 거절이 동시에 대기하지 않는다.
CREATE UNIQUE INDEX match_intents_one_pending_answer
  ON match_intents (match_request_id)
  WHERE status = 'PENDING' AND kind <> 'SEND';

-- 주선자 큐가 매번 읽는 경로.
CREATE INDEX match_intents_pending_idx
  ON match_intents (created_at)
  WHERE status = 'PENDING';

CREATE INDEX match_intents_by_profile_idx
  ON match_intents (profile_id, created_at DESC);

-- 결정 시각은 코드가 아니라 DB 가 찍는다(match_requests_stamp 와 같은 규칙).
CREATE OR REPLACE FUNCTION match_intents_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'PENDING' THEN
    NEW.decided_at := coalesce(NEW.decided_at, now());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER match_intents_stamp_trg BEFORE UPDATE ON match_intents
  FOR EACH ROW EXECUTE FUNCTION match_intents_stamp();

-- ── RLS ───────────────────────────────────────────────────────
-- 핵심: 상대는 이 행을 **읽을 수 없다.** 본인과 본인의 담당 주선자만 본다.
ALTER TABLE match_intents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON match_intents TO bolsaram_app;

CREATE POLICY match_intents_read ON match_intents FOR SELECT
  USING (
    profile_id = app_current_profile_id()
    OR app_can_edit_profile(profile_id)
  );

-- 낼 수 있는 것은 본인(또는 본인을 대행 중인 주선자)뿐이다.
CREATE POLICY match_intents_create ON match_intents FOR INSERT
  WITH CHECK (
    profile_id = app_current_profile_id()
    AND status = 'PENDING'
    AND (
      -- SEND: 풀을 넘는 요청은 만들 수 없다(match_requests_create 와 같은 규칙).
      (kind = 'SEND' AND EXISTS (
        SELECT 1 FROM profiles t
         WHERE t.id = target_profile_id
           AND t.group_id IS NOT DISTINCT FROM app_current_member_group()
      ))
      -- 답: 그 신청의 당사자여야 한다.
      OR (kind <> 'SEND' AND EXISTS (
        SELECT 1 FROM match_requests mr
         WHERE mr.id = match_request_id
           AND (mr.requester_profile_id = profile_id OR mr.target_profile_id = profile_id)
      ))
    )
  );

-- 승인·반려는 담당 주선자만 한다.
CREATE POLICY match_intents_decide ON match_intents FOR UPDATE
  USING (app_can_edit_profile(profile_id))
  WITH CHECK (app_can_edit_profile(profile_id));

-- 본인은 아직 확인되지 않은 자기 요청을 거둘 수 있다.
CREATE POLICY match_intents_withdraw ON match_intents FOR DELETE
  USING (profile_id = app_current_profile_id() AND status = 'PENDING');

-- ── 알림 ──────────────────────────────────────────────────────
-- 승인 전에는 match_requests 행이 없으므로 기존 트리거가 돌지 않는다. 주선자가
-- 모르면 요청이 큐에서 잠들기만 하니 여기서 따로 알린다.
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'MEMBER_INTENT';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS match_intent_id uuid REFERENCES match_intents(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX notifications_intent_dedupe_idx
  ON notifications (kind, match_intent_id, recipient_user_id)
  WHERE match_intent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app_enqueue_intent_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- payload 에는 공개 번호만. 인사말·이름·연락처는 넣지 않는다(0017 과 같은 규칙).
  INSERT INTO notifications (kind, recipient_user_id, match_intent_id, payload)
  SELECT
    'MEMBER_INTENT',
    admins.recipient,
    NEW.id,
    jsonb_build_object(
      'kind', NEW.kind::text,
      'fromCode', (SELECT public_code FROM profiles WHERE id = NEW.profile_id),
      'toCode', (
        SELECT public_code FROM profiles
         WHERE id = coalesce(
           NEW.target_profile_id,
           (SELECT CASE WHEN mr.requester_profile_id = NEW.profile_id
                        THEN mr.target_profile_id ELSE mr.requester_profile_id END
              FROM match_requests mr WHERE mr.id = NEW.match_request_id)
         )
      )
    )
  FROM (SELECT app_profile_admins(NEW.profile_id) AS recipient) admins
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_intent_notification() FROM PUBLIC;

CREATE TRIGGER match_intents_notify_created
  AFTER INSERT ON match_intents
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_intent_notification();
