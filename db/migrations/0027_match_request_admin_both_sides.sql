-- 0027: 신청은 양쪽 주선자가 다룬다
--
-- 0011 까지 match_requests 의 주선자 정책은 **신청자 쪽** 담당자만 봤다.
-- 한 사람이 양쪽을 등록했거나 두 사람이 같은 모임이면 문제가 없어서 드러나지 않았다.
--
-- 0026 이 그 가정을 깬다. 「수락」은 **받은 쪽**이 내는 답이고, 그 요청을 확인하는 것은
-- 받은 쪽 담당 주선자다. 그런데 승인이 실제로 하는 일은 match_requests 를 옮기는
-- 것이라, 전체공개 풀에서 양쪽 등록 주선자가 다르면 큐에는 요청이 보이는데 승인만
-- 실패한다. 확인할 수 있는 사람과 반영할 수 있는 사람이 어긋난 것이다.
--
-- 두 정책을 양쪽 담당자로 넓혀 맞춘다. 넓어지는 범위는 **자기가 등록한 회원이 낀
-- 신청**뿐이다 — 무관한 신청은 여전히 보이지 않는다.

DROP POLICY match_requests_read ON match_requests;
CREATE POLICY match_requests_read ON match_requests FOR SELECT
  USING (
    app_can_edit_profile(requester_profile_id)
    OR app_can_edit_profile(target_profile_id)
    OR requester_profile_id = app_current_profile_id()
    OR target_profile_id = app_current_profile_id()
  );

DROP POLICY match_requests_admin_update ON match_requests;
CREATE POLICY match_requests_admin_update ON match_requests FOR UPDATE
  USING (
    app_can_edit_profile(requester_profile_id)
    OR app_can_edit_profile(target_profile_id)
  )
  WITH CHECK (
    app_can_edit_profile(requester_profile_id)
    OR app_can_edit_profile(target_profile_id)
  );
