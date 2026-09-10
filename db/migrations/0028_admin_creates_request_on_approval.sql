-- 0028: 주선자가 회원을 대신해 신청을 만든다
--
-- 0026 에서 회원의 「마음 보내기」는 요청이 되고, 실제 신청은 주선자가 승인할 때
-- 만들어진다. 그런데 match_requests_create 는 `requester_profile_id =
-- app_current_profile_id()` 만 허용한다. 승인하는 주선자에게는 프로필이 없으므로
-- 그 값이 NULL 이고, **승인이 통째로 막힌다**(적용 전 실측으로 확인했다).
--
-- 대행 중인 주선자는 app_current_profile_id() 가 대상 프로필로 풀려서 통과했다.
-- 즉 폰을 쓰지 않는 회원은 되고 폰을 쓰는 회원은 안 되는, 뒤집힌 상태였다.
--
-- 그래서 담당 주선자에게도 만들 권한을 준다. 「주선자가 사이에서 말을 옮긴다」는
-- 제품의 전제를 정책에 그대로 적는 것이다.
--
-- 풀 경계는 그대로 지킨다. 다만 기준이 다르다 — 회원 경로는 **자기 풀**을 보고,
-- 주선자 경로는 세션에 풀이 없으므로 **신청자 본인의 풀**을 본다. 결과는 같다:
-- 모임 ↔ 전체공개를 넘는 신청은 어느 경로로도 만들어지지 않는다.

DROP POLICY match_requests_create ON match_requests;
CREATE POLICY match_requests_create ON match_requests FOR INSERT
  WITH CHECK (
    target_profile_id <> requester_profile_id
    AND (
      -- 본인(또는 본인을 대행 중인 주선자)이 직접 만든다.
      (
        requester_profile_id = app_current_profile_id()
        AND EXISTS (
          SELECT 1 FROM profiles t
           WHERE t.id = target_profile_id
             AND t.group_id IS NOT DISTINCT FROM app_current_member_group()
        )
      )
      -- 담당 주선자가 회원의 요청을 승인하며 만든다(0026).
      OR (
        app_can_edit_profile(requester_profile_id)
        AND EXISTS (
          SELECT 1 FROM profiles r JOIN profiles t ON TRUE
           WHERE r.id = requester_profile_id
             AND t.id = target_profile_id
             AND t.group_id IS NOT DISTINCT FROM r.group_id
        )
      )
    )
  );
