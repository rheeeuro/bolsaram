-- 0078: 거절을 거두는 것은 받은 쪽 담당 주선자만
--
-- 거절을 기록할 수 있는 사람(0038)과 같은 사람이 거둔다. 신청자 쪽 담당이 거두면
-- 상대가 거절한 사이를 상대 동의 없이 다시 여는 셈이다.
-- 멤버 본인(당사자 정책)은 도메인 레이어가 막는다 — 철회는 주선자만 하는 전이다.

DROP POLICY match_requests_admin_update ON match_requests;
CREATE POLICY match_requests_admin_update ON match_requests FOR UPDATE
  USING (
    app_can_edit_profile(requester_profile_id)
    OR app_can_edit_profile(target_profile_id)
  )
  WITH CHECK (
    CASE status
      WHEN 'INTRODUCED' THEN app_can_edit_profile(target_profile_id)
      WHEN 'REJECTED'   THEN app_can_edit_profile(target_profile_id)
      WHEN 'WITHDRAWN'  THEN app_can_edit_profile(target_profile_id)
      WHEN 'CANCELED'   THEN app_can_edit_profile(requester_profile_id)
      WHEN 'CLOSED'     THEN app_can_edit_profile(requester_profile_id)
                          OR app_can_edit_profile(target_profile_id)
      -- 위에 없는 결과 상태로 옮기는 경로는 아직 없다. 생기면 여기에 적는다.
      ELSE false
    END
  );
