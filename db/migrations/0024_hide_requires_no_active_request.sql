-- 0024: 숨기기는 진행 중인 신청이 없을 때만
--
-- 0023 은 「숨긴 관계에는 신청할 수 없다」만 막았다. 반대 순서가 열려 있었다 —
-- 신청을 보낸 뒤 숨기면 신청은 REQUESTED 로 남고, 상대가 그것을 수락하면
-- **숨긴 사이인데 연결된** 상태가 된다. 화면은 연결된 상대에게 숨김 해제를 주지
-- 않으므로 회원이 스스로 되돌릴 수 없다.
--
-- 두 규칙이 한 방향만 막고 있었던 것이 원인이다. 여기서 반대쪽을 막으면 순서에
-- 상관없이 「숨김 + 활성 신청」이 만들어지지 않는다.
--
--   활성 신청이 있으면 → 숨기지 못한다 (이 마이그레이션)
--   숨긴 관계이면     → 신청하지 못한다 (0023)
--
-- 그래서 숨기기는 거절을 대신하지 않는다. 받은 신청은 먼저 거절하고, 보낸 신청은
-- 먼저 취소한 다음 숨긴다. 거절 자체가 이미 재신청을 막으므로 흐름이 겹치지 않는다.

/**
 * 활성 신청(REQUESTED · INTRODUCED)이 있는 상대는 숨기지 못한다.
 *
 * 애플리케이션 레이어(assertCanHide)가 같은 판정을 먼저 하고 사람이 읽을 메시지를
 * 준다. 이 트리거는 그것을 대체하지 않고 최종 방어선으로 남는다.
 *
 * DEFINER 로 두는 이유는 판정이 호출자에게 보이는 행에 좌우되면 안 되기 때문이다.
 */
CREATE OR REPLACE FUNCTION profile_hides_block_active_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM match_requests mr
    WHERE mr.status IN ('REQUESTED','INTRODUCED')
      AND (
        (mr.requester_profile_id = NEW.hider_profile_id AND mr.target_profile_id = NEW.hidden_profile_id)
        OR
        (mr.requester_profile_id = NEW.hidden_profile_id AND mr.target_profile_id = NEW.hider_profile_id)
      )
  ) THEN
    RAISE EXCEPTION '진행 중인 신청이 있어 숨길 수 없습니다.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER profile_hides_block_active_request_trg BEFORE INSERT ON profile_hides
  FOR EACH ROW EXECUTE FUNCTION profile_hides_block_active_request();
