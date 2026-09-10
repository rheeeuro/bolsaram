-- 0033: 취소도 받는 쪽 주선자에게 알린다
--
-- 0032 는 거절을 신청자 쪽 담당자에게 알리게 했다. 취소는 그 대칭이다 —
-- 신청자가 마음을 거두면 **받는 쪽** 회원이 답을 기다리다 사라진 신청을 만난다.
-- 그 회원에게도 화면 알림은 뜨지 않으므로 사정을 말해줄 사람이 필요하다.
--
-- 취소를 누르는 것은 신청자 쪽이다(본인, 그를 대행하는 주선자, 또는 그의 취소 요청을
-- 승인한 주선자). 그래서 받는 쪽 담당자에게 알리고, 0031·0032 와 같은 규칙으로
-- 누른 사람만 뺀다.
--
-- 신청자 쪽 담당자에게는 보내지 않는다. 그쪽은 자기 회원이 거둔 것을 이미 알고 있다.

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'MATCH_CANCELED';

CREATE OR REPLACE FUNCTION app_enqueue_match_canceled_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'CANCELED' OR OLD.status = 'CANCELED' THEN
    RETURN NEW;
  END IF;

  -- payload 에는 공개 번호만(0017 과 같은 규칙).
  INSERT INTO notifications (kind, recipient_user_id, match_request_id, payload)
  SELECT
    'MATCH_CANCELED',
    admins.recipient,
    NEW.id,
    jsonb_build_object(
      'requesterCode', (SELECT public_code FROM profiles WHERE id = NEW.requester_profile_id),
      'targetCode',    (SELECT public_code FROM profiles WHERE id = NEW.target_profile_id)
    )
  FROM (SELECT app_profile_admins(NEW.target_profile_id) AS recipient) admins
  WHERE admins.recipient IS DISTINCT FROM app_current_user_id()
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_match_canceled_notification() FROM PUBLIC;

CREATE TRIGGER match_requests_notify_canceled
  AFTER UPDATE OF status ON match_requests
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_match_canceled_notification();
