-- 0029: 요청 알림 payload 를 아웃박스가 읽는 키에 맞춘다
--
-- 0026 의 트리거는 `fromCode`/`toCode` 로 넣는데 아웃박스는 `requesterCode`/`targetCode`
-- 를 읽는다(0017). 그대로 두면 알림은 나가되 번호가 비어 「? → ?」 로 보인다.
-- 발송 경로를 갈래로 나누기보다 payload 를 하나로 맞춘다.

CREATE OR REPLACE FUNCTION app_enqueue_intent_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- payload 에는 공개 번호만. 인사말·이름·연락처는 넣지 않는다(0017 과 같은 규칙).
  -- requesterCode 는 「요청을 낸 사람」이다 — 수락 요청이면 받은 쪽이 여기 온다.
  INSERT INTO notifications (kind, recipient_user_id, match_intent_id, payload)
  SELECT
    'MEMBER_INTENT',
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
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
