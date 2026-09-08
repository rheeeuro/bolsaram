-- 0022: 연결이 종료돼도 이름·연락처 공개는 유지된다
--
-- 종료(CLOSED)는 주선자가 목록을 정리하는 행위이고 공개 철회가 아니다.
-- 이미 서로 본 이름과 연락처를 시스템이 되돌릴 수도 없다.
-- 애플리케이션 레이어(`introducedPartnerIds`)와 같은 기준을 갖도록 맞춘다 —
-- 어느 한쪽만 고치면 「공개 대상이 누구인가」가 두 갈래로 갈린다.

CREATE OR REPLACE FUNCTION app_is_introduced_with(other_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_requests mr
    WHERE mr.status IN ('INTRODUCED','CLOSED')
      AND (
        (mr.requester_profile_id = app_current_profile_id() AND mr.target_profile_id = other_profile_id)
        OR
        (mr.target_profile_id = app_current_profile_id() AND mr.requester_profile_id = other_profile_id)
      )
  )
$$;
REVOKE ALL ON FUNCTION app_is_introduced_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_introduced_with(uuid) TO bolsaram_app;
