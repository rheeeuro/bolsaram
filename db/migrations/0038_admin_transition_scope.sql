-- 0038: 답을 옮기는 것은 그 사람의 담당 주선자만
--
-- 0027 은 match_requests 의 주선자 UPDATE 를 「양쪽 담당 누구나」로 넓혔다. 0026 이
-- 나눈 확인 경로(받은 쪽 답은 받은 쪽 담당이 확인한다)를 신청 테이블이 따라가지
-- 못해 승인만 실패했기 때문이다.
--
-- 그런데 그 정책은 승인 경로만 열어 준 것이 아니다. 주선자 화면의 상태 조작
-- (`/api/admin/match-requests/:id/accept`)도 같은 정책을 타므로, 신청자 쪽 담당
-- 주선자가 **상대의 수락을 단독으로 기록**할 수 있다. 수락은 연락처 상호 공개이고
-- 그 동의는 상대가 낸 것이어야 한다. 전체공개 풀에서 두 사람의 등록 주선자가
-- 다르면 실제로 통과한다(적용 전 실측으로 확인했다).
--
-- 그래서 읽기는 그대로 두고 **옮길 수 있는 방향만** 좁힌다. 누가 낸 답인지가
-- 기준이다:
--
--   수락(INTRODUCED) · 거절(REJECTED)  → 받은 쪽 담당만
--   취소(CANCELED)                     → 신청자 쪽 담당만
--   종료(CLOSED)                       → 양쪽 담당 누구나 (정리는 운영 행위다)
--
-- 대행 중인 주선자는 영향받지 않는다 — `app_current_profile_id()` 가 회원으로 풀려
-- `match_requests_participant_update` 를 통과한다. 당사자를 대신해 그 자리에서
-- 누르는 것은 그대로 되고, 남의 회원 몫을 대신 결정하는 것만 막힌다.

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
      WHEN 'CANCELED'   THEN app_can_edit_profile(requester_profile_id)
      WHEN 'CLOSED'     THEN app_can_edit_profile(requester_profile_id)
                          OR app_can_edit_profile(target_profile_id)
      -- 위에 없는 결과 상태로 옮기는 경로는 아직 없다. 생기면 여기에 적는다.
      ELSE false
    END
  );

-- ── 관계 판정: 누구와 누구인지 인자로 받는다 ──────────────────
--
-- 0023 의 판정 함수는 한쪽을 `app_current_profile_id()` 에서 가져온다. 회원 경로에서는
-- 맞지만 **주선자가 승인하며 신청을 만드는 경로**(0028)에서는 그 값이 NULL 이라 어떤
-- 관계도 찾지 못한다. 거절·숨김이 있어도 `assertRequestable` 이 통과하고, INSERT 에
-- 걸린 트리거가 check_violation 으로 터진다 — 사람이 읽을 메시지 대신 500 이 된다.
--
-- 두 프로필을 직접 받는 형태를 더해 어느 경로에서든 같은 판정을 할 수 있게 한다.
-- 기존 한 인자 형태는 그대로 두고 현재 프로필을 채워 넘기는 껍데기로 바꾼다 —
-- 회원 경로의 호출부(탐색·상세·신청)는 하나도 고치지 않는다.

CREATE OR REPLACE FUNCTION app_is_rejected_between(a_profile_id uuid, b_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_requests mr
    WHERE mr.status = 'REJECTED'
      AND (
        (mr.requester_profile_id = a_profile_id AND mr.target_profile_id = b_profile_id)
        OR
        (mr.target_profile_id = a_profile_id AND mr.requester_profile_id = b_profile_id)
      )
  )
$$;
REVOKE ALL ON FUNCTION app_is_rejected_between(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_rejected_between(uuid, uuid) TO bolsaram_app;

CREATE OR REPLACE FUNCTION app_is_hidden_between(a_profile_id uuid, b_profile_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_hides h
    WHERE (h.hider_profile_id = a_profile_id AND h.hidden_profile_id = b_profile_id)
       OR (h.hider_profile_id = b_profile_id AND h.hidden_profile_id = a_profile_id)
  )
$$;
REVOKE ALL ON FUNCTION app_is_hidden_between(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_hidden_between(uuid, uuid) TO bolsaram_app;

CREATE OR REPLACE FUNCTION app_is_rejected_between(other_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_rejected_between(app_current_profile_id(), other_profile_id)
$$;

CREATE OR REPLACE FUNCTION app_is_hidden_between(other_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_hidden_between(app_current_profile_id(), other_profile_id)
$$;
