-- 0025: 주선자 대행 (acting profile)
--
-- 등록된 사람이 자기 휴대폰을 쓰지 않는 경우가 정상 운영이다. 그때 주선자가
-- 자기 폰으로 회원 화면을 대신 조작한다. 지금까지 그 방법은 초대 링크를 주선자가
-- 직접 여는 것뿐이었는데, 그러면 주선자가 로그아웃되고(세션 쿠키가 덮인다)
-- 초대가 소진되며 회원 목록이 「들어온 분」으로 오염된다. 되돌릴 수 없다.
--
-- 그래서 세션에 「지금 누구를 대신하는가」를 얹는다. 주선자 세션은 그대로 두고
-- 회원 프로필 컨텍스트만 갈아끼운다.
--
-- 경계는 **여기 한 곳에서** 강제한다:
--   1) 대상 프로필이 아직 아무 계정에도 연결되지 않았을 것 (user_id IS NULL)
--   2) 호출자가 주선자이고, 그 프로필을 고칠 수 있을 것 (app_can_edit_profile)
--
-- (1) 덕분에 당사자가 나중에 자기 초대를 받아 들어오는 순간 user_id 가 채워지고
-- 대행이 자동으로 닫힌다 — 화면이 아니라 데이터베이스가 지킨다.
--
-- 회원 측 정책 전부가 app_current_profile_id() 하나를 거치므로 이 함수만 바꾸면
-- 신청·관심·숨김·공개단계 정책이 따라온다. 정책은 하나도 다시 쓰지 않는다.
--
-- 애플리케이션 레이어도 같은 판정을 중복으로 한다(가드). 이 마이그레이션은
-- 그것을 대체하지 않고 최종 방어선으로 남는다.

-- ── 세션에 대행 대상을 남긴다 ────────────────────────────────
-- 쿠키가 아니라 서버 측 상태로 둔다. 세션을 지우면 대행도 함께 끝나고,
-- 프로필이 지워지면 참조가 저절로 풀린다.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS acting_profile_id uuid
    REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN sessions.acting_profile_id IS
  '주선자가 대신 조작 중인 미연결 프로필. 권한 판정은 app_current_profile_id() 가 한다.';

-- ── 요청 컨텍스트에서 읽는 대행 대상 ─────────────────────────
-- withRls 가 app.acting_profile_id 로 넘긴다. 값이 있다는 것만으로는
-- 아무 권한도 주지 않는다 — 판정은 아래 app_current_profile_id() 가 한다.
CREATE OR REPLACE FUNCTION app_acting_profile_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.acting_profile_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION app_acting_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_acting_profile_id() TO bolsaram_app;

/**
 * 현재 요청이 「회원으로서」 보는 프로필.
 *
 * 대행이 걸려 있고 조건을 만족하면 그 프로필, 아니면 본인 프로필이다.
 * DEFINER 로 두는 이유는 이전과 같다 — 판정이 호출자에게 보이는 행에 좌우되면
 * 안 되기 때문이다(0006).
 */
CREATE OR REPLACE FUNCTION app_current_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT p.id FROM profiles p
       WHERE p.id = app_acting_profile_id()
         -- 본인이 쓰기 시작한 프로필은 대행할 수 없다.
         AND p.user_id IS NULL
         AND app_is_admin()
         AND app_can_edit_profile(p.id)
    ),
    (SELECT id FROM profiles WHERE user_id = app_current_user_id())
  )
$$;

/**
 * 현재 「회원으로서」 속한 풀.
 *
 * 0010 은 user_id 에서 바로 파생했다. 대행 중에는 주선자 계정에 프로필이 없어
 * NULL 이 되고, 그러면 match_requests_create 의 풀 경계 검사(모임 ↔ 전체공개)가
 * 엉뚱하게 판정된다. 프로필을 먼저 정하고 거기서 파생하도록 바꾼다 —
 * 본인 세션에서는 결과가 이전과 같다.
 */
CREATE OR REPLACE FUNCTION app_current_member_group() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT group_id FROM profiles WHERE id = app_current_profile_id()
$$;
