-- 0031: 보류는 그 회원의 주선자에게 알린다
--
-- 0030 은 보류된 상대를 회원 목록에서 조용히 빼는 것까지만 했다. 회원에게 사정을
-- 알려주는 것은 주선자의 몫인데, **보류한 사람이 그 회원의 주선자가 아닐 수 있다.**
-- app_can_edit_profile 은 같은 모임 주선자 누구나 참이므로 동료가 대신 처리할 수
-- 있고, 그러면 정작 회원에게 말해줄 사람이 그 사실을 모른 채 지나간다.
--
-- 그래서 보류될 때 그 회원의 담당자 전원에게 남긴다. **누른 사람만 뺀다** — 자기가
-- 방금 한 일을 자기에게 알리지 않는다.
--
-- 요청이 들어올 때(0026)와 같은 규칙을 지킨다: payload 에는 공개 번호만 싣고,
-- 인사말·이름·연락처·보류 사유는 넣지 않는다. 사유는 화면에서 본다.

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'INTENT_DECLINED';

CREATE OR REPLACE FUNCTION app_enqueue_intent_declined_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'DECLINED' OR OLD.status = 'DECLINED' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (kind, recipient_user_id, match_intent_id, payload)
  SELECT
    'INTENT_DECLINED',
    admins.recipient,
    NEW.id,
    jsonb_build_object(
      'intentKind', NEW.kind::text,
      'requesterCode', (SELECT public_code FROM profiles WHERE id = NEW.profile_id),
      'targetCode', (
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
  -- 자기가 누른 것은 자기에게 알리지 않는다.
  WHERE admins.recipient IS DISTINCT FROM NEW.decided_by
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_intent_declined_notification() FROM PUBLIC;

CREATE TRIGGER match_intents_notify_declined
  AFTER UPDATE OF status ON match_intents
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_intent_declined_notification();
