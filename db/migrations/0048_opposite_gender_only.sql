-- 0048: 회원이 보는 사람은 이성만
--
-- 볼사람은 이성 소개만 다루는데 그 경계가 어디에도 없었다. 회원 탐색 목록에 동성이
-- 그대로 섞여 나오고(실측 2026-09-17: 여성 회원의 목록 24건 중 12건이 여성), 주소를
-- 직접 열면 상세도 열리며, 신청까지 들어갔다. 화면은 「전체 · 남성 · 여성」 탭을 주고
-- 기본값이 「전체」였으니 회원이 고를 수 있는 값으로 다뤄져 온 셈이다.
--
-- 애플리케이션 레이어가 목록·상세·신청에서 같은 판정을 하고(`isOppositeGender`),
-- 여기서는 DB 가 최종 방어선을 맡는다.
--
-- **대행(acting)은 이 정책으로 막히지 않는다.** 대행 중인 주선자는 회원 절이 아니라
-- 주선자 절(app_can_view_profile_as_admin)로 프로필을 보기 때문이다. 대행의 경계는
-- 앱 레이어가 판정한다(`isMemberView`) — 그래서 두 레이어가 서로를 대체하지 않는다.

-- ── 보는 사람의 성별 ─────────────────────────────────────────
-- 대행을 반영해야 하므로 user_id 가 아니라 app_current_profile_id() 로 읽는다
-- (0025 에서 app_current_member_group 이 같은 이유로 바뀌었다).
-- STABLE 이라 쿼리당 한 번만 평가된다 — 행마다 서브쿼리를 돌지 않는다.
CREATE OR REPLACE FUNCTION app_current_member_gender() RETURNS gender
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gender FROM profiles WHERE id = app_current_profile_id()
$$;
REVOKE ALL ON FUNCTION app_current_member_gender() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_member_gender() TO bolsaram_app;

-- ── 열람 ─────────────────────────────────────────────────────
-- 0011 의 정책에 성별 조건 하나를 더한다. 나머지 절은 그대로다.
-- 자기 프로필은 `user_id = app_current_user_id()` 절로 계속 보인다.
DROP POLICY profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (
    app_can_view_profile_as_admin(group_id)
    OR user_id = app_current_user_id()
    -- 회원은 **자기와 같은 풀 안의 이성** 공개 프로필만 본다.
    -- IS NOT DISTINCT FROM 이라 전체공개 회원끼리도 서로 보인다(둘 다 NULL).
    OR (
      app_current_profile_id() IS NOT NULL
      AND group_id IS NOT DISTINCT FROM app_current_member_group()
      AND status IN ('ACTIVE','MATCHING')
      AND visibility <> 'PRIVATE'
      AND gender <> app_current_member_gender()
    )
  );

-- ── 신청 ─────────────────────────────────────────────────────
/**
 * 동성에게는 신청이 만들어지지 않는다.
 *
 * 애플리케이션 레이어(assertCanCreateRequest)가 같은 판정을 먼저 하고 사람이 읽을
 * 메시지를 준다. 0023 의 트리거와 같은 자리 — 검사를 빠뜨린 경로가 생겨도 DB 가 막는다.
 *
 * 판정이 호출자에게 보이는 행에 좌우되면 안 되므로 DEFINER 다. 주선자 경로에서는
 * 두 프로필이 RLS 로 보이지만 그 사실에 기대지 않는다.
 */
CREATE OR REPLACE FUNCTION match_requests_require_opposite_gender() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requester_gender gender;
  target_gender    gender;
BEGIN
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

CREATE TRIGGER match_requests_require_opposite_gender_trg BEFORE INSERT ON match_requests
  FOR EACH ROW EXECUTE FUNCTION match_requests_require_opposite_gender();
