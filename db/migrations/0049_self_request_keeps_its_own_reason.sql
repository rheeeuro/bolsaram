-- 0049: 자기 자신에게 낸 신청은 전용 제약이 이유를 말한다
--
-- 0048 의 이성 검사는 BEFORE INSERT 트리거라 CHECK 제약(match_requests_no_self)보다
-- 먼저 돈다. 자기 자신에게 낸 신청은 성별이 당연히 같으므로 「같은 성별에게는
-- 신청할 수 없습니다」라는 엉뚱한 이유가 돌아갔다.
--
-- 규칙마다 자기 이유를 말해야 로그와 오류 메시지로 원인을 가릴 수 있다.
-- 자기 자신인 경우는 트리거가 비켜서고 제약이 잡는다.

CREATE OR REPLACE FUNCTION match_requests_require_opposite_gender() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requester_gender gender;
  target_gender    gender;
BEGIN
  IF NEW.requester_profile_id = NEW.target_profile_id THEN
    RETURN NEW;
  END IF;

  SELECT gender INTO requester_gender FROM profiles WHERE id = NEW.requester_profile_id;
  SELECT gender INTO target_gender FROM profiles WHERE id = NEW.target_profile_id;

  IF requester_gender IS NOT NULL
     AND target_gender IS NOT NULL
     AND requester_gender = target_gender THEN
    RAISE EXCEPTION '같은 성별에게는 신청할 수 없습니다.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;
