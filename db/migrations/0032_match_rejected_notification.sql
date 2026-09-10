-- 0032: 거절도 그 회원의 주선자에게 알린다
--
-- 알림 트리거는 지금까지 INSERT(새 신청)와 INTRODUCED(연결)만 봤다(0017·0021).
-- **거절에는 아무 알림도 없었다.** 중개(0026) 이전부터 있던 구멍이다.
--
-- 거절당한 쪽은 마음을 보낸 사람이다. 그 사람에게는 화면에 알림이 뜨지 않고
-- (회원용 알림 채널을 만들지 않기로 했다, 2026-09-08) 상대 프로필은 목록에서 조용히
-- 사라진다(0023). 사정을 말해줄 사람은 **그 회원의 주선자**인데, 거절을 처리한 것은
-- 받은 쪽 주선자다 — 전체공개 풀이거나 모임에 주선자가 여럿이면 서로 다른 사람이다.
-- 그러면 정작 말해줄 사람이 모른 채 지나간다.
--
-- 그래서 거절될 때 **신청자 쪽 담당자**에게 남긴다. 0031 과 같은 규칙으로 누른 사람만
-- 뺀다 — 자기가 방금 한 일을 자기에게 알리지 않는다.
--
-- 받는 쪽 담당자에게는 보내지 않는다. 그쪽은 자기 회원의 답을 이미 알고 있다.

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'MATCH_REJECTED';

CREATE OR REPLACE FUNCTION app_enqueue_match_rejected_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'REJECTED' OR OLD.status = 'REJECTED' THEN
    RETURN NEW;
  END IF;

  -- payload 에는 공개 번호만. 거절 사유는 넣지 않는다(0017 과 같은 규칙).
  INSERT INTO notifications (kind, recipient_user_id, match_request_id, payload)
  SELECT
    'MATCH_REJECTED',
    admins.recipient,
    NEW.id,
    jsonb_build_object(
      'requesterCode', (SELECT public_code FROM profiles WHERE id = NEW.requester_profile_id),
      'targetCode',    (SELECT public_code FROM profiles WHERE id = NEW.target_profile_id)
    )
  FROM (SELECT app_profile_admins(NEW.requester_profile_id) AS recipient) admins
  WHERE admins.recipient IS DISTINCT FROM app_current_user_id()
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_match_rejected_notification() FROM PUBLIC;

CREATE TRIGGER match_requests_notify_rejected
  AFTER UPDATE OF status ON match_requests
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_match_rejected_notification();
