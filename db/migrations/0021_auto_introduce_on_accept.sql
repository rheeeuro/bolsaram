-- 0021: 수락하면 바로 연결된다 — 주선자의 연결 게이트 제거
--
-- 상대의 수락이 곧 동의이므로 그 뒤에 주선자 승인을 한 번 더 두지 않는다.
-- REQUESTED ─수락─► INTRODUCED ─► CLOSED 로 상태가 하나 줄어든다.
-- enum 값 'ACCEPTED' 자체는 남기지만(Postgres 는 값 제거를 지원하지 않는다)
-- 이 마이그레이션 이후 어떤 코드도 그 값을 쓰지 않는다.

-- 남아 있던 수락 대기 건을 연결로 올린다.
-- 아래에서 트리거 함수를 바꾸기 **전에** 돌려야 한다 — 지금의 알림 트리거는
-- INTRODUCED 를 무시하므로 과거 건에 대한 알림이 쏟아지지 않는다.
-- introduced_at 은 stamp 트리거가 지금 시각으로 채운다(연결 시점이 곧 이 시각이다).
UPDATE match_requests SET status = 'INTRODUCED' WHERE status = 'ACCEPTED';

-- 활성 신청 유니크 인덱스에서 사라진 상태를 뺀다.
DROP INDEX match_requests_one_active;
CREATE UNIQUE INDEX match_requests_one_active
  ON match_requests (requester_profile_id, target_profile_id)
  WHERE status IN ('REQUESTED','INTRODUCED');

-- 수락이 곧 연결이므로 INTRODUCED 에서 응답 시각도 함께 찍는다.
-- 이미 찍혀 있으면(관리자가 나중에 종료·재전이) 덮어쓰지 않는다.
CREATE OR REPLACE FUNCTION match_requests_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('REJECTED','CANCELED') THEN
      NEW.responded_at := now();
    ELSIF NEW.status = 'INTRODUCED' THEN
      NEW.responded_at := coalesce(NEW.responded_at, now());
      NEW.introduced_at := now();
    ELSIF NEW.status = 'CLOSED' THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- 알림은 그대로 두 종류다. 다만 두 번째가 「연결해 주세요」에서
-- 「연결됐습니다」로 바뀐다 — 주선자가 할 일은 없지만 실제 소개는 사람이 하므로
-- 연결이 생긴 사실은 알아야 한다. kind 이름은 이벤트(상대가 수락함) 기준이라 유지한다.
CREATE OR REPLACE FUNCTION app_enqueue_match_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event_kind notification_kind;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_kind := 'MATCH_REQUESTED';
  ELSIF NEW.status = 'INTRODUCED' AND OLD.status IS DISTINCT FROM 'INTRODUCED' THEN
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
    SELECT app_profile_admins(NEW.target_profile_id) AS recipient
    UNION
    SELECT app_profile_admins(NEW.requester_profile_id)
  ) admins
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_match_notification() FROM PUBLIC;

-- 트리거 이름은 0017 그대로 쓴다(함수만 갈아끼웠다).
ALTER TRIGGER match_requests_notify_accepted ON match_requests
  RENAME TO match_requests_notify_introduced;
