-- 0006: Row Level Security (설계문서 §12 「RLS 필수」)
--
-- 원칙:
--   * 모든 테이블에 RLS 를 켜고 기본은 거부. 정책이 있는 경로만 통과한다.
--   * 런타임 롤 bolsaram_app 은 NOBYPASSRLS 이므로 정책을 우회할 수 없다.
--   * 인증 이전에 읽어야 하는 테이블(sessions/login_codes/users 인증 경로)은
--     app 롤에 정책을 주지 않는다. 인증 레이어만 owner 커넥션으로 접근한다.
--   * 애플리케이션 레이어 권한 검사는 이 정책을 대체하지 않고 중복으로 둔다.

-- ── 헬퍼: 현재 사용자의 프로필 id ────────────────────────────
CREATE OR REPLACE FUNCTION app_current_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM profiles WHERE user_id = app_current_user_id()
$$;
REVOKE ALL ON FUNCTION app_current_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_profile_id() TO bolsaram_app;

-- 상대와 INTRODUCED 상태인지 — 이름/연락처 공개 판정에 쓴다.
CREATE OR REPLACE FUNCTION app_is_introduced_with(other_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_requests mr
    WHERE mr.status = 'INTRODUCED'
      AND (
        (mr.requester_profile_id = app_current_profile_id() AND mr.target_profile_id = other_profile_id)
        OR
        (mr.target_profile_id = app_current_profile_id() AND mr.requester_profile_id = other_profile_id)
      )
  )
$$;
REVOKE ALL ON FUNCTION app_is_introduced_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_introduced_with(uuid) TO bolsaram_app;

-- ── users ─────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_select ON users FOR SELECT
  USING (id = app_current_user_id() OR app_is_admin());
CREATE POLICY users_self_update ON users FOR UPDATE
  USING (id = app_current_user_id() OR app_is_admin())
  WITH CHECK (id = app_current_user_id() OR app_is_admin());
CREATE POLICY users_admin_insert ON users FOR INSERT
  WITH CHECK (app_is_admin());

-- ── profiles ──────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 회원은 공개 상태 프로필과 자기 프로필만 읽는다.
-- PRIVATE 은 관리자 외 접근 불가, UNLISTED 는 링크로 상세 접근만 허용하므로
-- 리스트 제외는 SQL 쿼리(buildDiscoverWhere)가 담당한다.
CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (
    app_is_admin()
    OR user_id = app_current_user_id()
    OR (status IN ('ACTIVE','MATCHING') AND visibility <> 'PRIVATE')
  );

CREATE POLICY profiles_admin_write ON profiles FOR INSERT
  WITH CHECK (app_is_admin());
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (app_is_admin())
  WITH CHECK (app_is_admin());
CREATE POLICY profiles_admin_delete ON profiles FOR DELETE
  USING (app_is_admin());

-- Claim: 아직 주인이 없는 프로필을 본인에게 연결하는 것만 회원에게 허용한다.
CREATE POLICY profiles_claim ON profiles FOR UPDATE
  USING (user_id IS NULL AND app_current_user_id() IS NOT NULL)
  WITH CHECK (user_id = app_current_user_id());

-- ── profile_images ────────────────────────────────────────────
ALTER TABLE profile_images ENABLE ROW LEVEL SECURITY;

-- 부모 프로필을 읽을 수 있으면 사진 메타데이터도 읽을 수 있다.
-- 실제 바이트 접근은 signed URL 이 따로 통제한다.
CREATE POLICY profile_images_read ON profile_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_id));
CREATE POLICY profile_images_admin_write ON profile_images FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ── match_requests ────────────────────────────────────────────
ALTER TABLE match_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_requests_read ON match_requests FOR SELECT
  USING (
    app_is_admin()
    OR requester_profile_id = app_current_profile_id()
    OR target_profile_id = app_current_profile_id()
  );

-- 신청은 반드시 자기 프로필 명의로만 만든다.
CREATE POLICY match_requests_create ON match_requests FOR INSERT
  WITH CHECK (
    requester_profile_id = app_current_profile_id()
    AND target_profile_id <> app_current_profile_id()
  );

-- 당사자는 상태를 바꿀 수 있다. 어떤 전이가 가능한지는 도메인 레이어가 판정하고
-- 조건부 UPDATE(WHERE status = ...)로 한 번 더 잠근다.
CREATE POLICY match_requests_participant_update ON match_requests FOR UPDATE
  USING (
    requester_profile_id = app_current_profile_id()
    OR target_profile_id = app_current_profile_id()
  )
  WITH CHECK (
    requester_profile_id = app_current_profile_id()
    OR target_profile_id = app_current_profile_id()
  );
CREATE POLICY match_requests_admin_update ON match_requests FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ── favorites ─────────────────────────────────────────────────
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY favorites_own ON favorites FOR ALL
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ── invites ───────────────────────────────────────────────────
-- 관리자만 다룬다. 토큰 claim 은 owner 커넥션의 인증 경로에서 처리한다.
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invites_admin ON invites FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ── import_* ──────────────────────────────────────────────────
ALTER TABLE import_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_sessions_admin ON import_sessions FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE import_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_assets_admin ON import_assets FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE import_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_extractions_admin ON import_extractions FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ── audit_logs ────────────────────────────────────────────────
-- 기록은 인증된 누구나 남길 수 있고, 열람은 관리자만.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (app_current_user_id() IS NOT NULL);
CREATE POLICY audit_logs_admin_read ON audit_logs FOR SELECT
  USING (app_is_admin());

-- ── 인증 전용 테이블 ──────────────────────────────────────────
-- 정책을 만들지 않는다 = bolsaram_app 은 접근 불가.
-- 세션/OTP 검증은 owner 커넥션을 쓰는 인증 레이어에서만 수행한다.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sessions FROM bolsaram_app;
REVOKE ALL ON login_codes FROM bolsaram_app;

-- 이미 만들어진 테이블/시퀀스에 대한 권한 부여(기본 권한은 이후 생성분에만 적용됨).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, profiles, profile_images, match_requests, favorites, invites,
  import_sessions, import_assets, import_extractions, audit_logs
  TO bolsaram_app;
GRANT SELECT ON import_latest_extractions TO bolsaram_app;
GRANT USAGE, SELECT ON SEQUENCE profile_public_code_seq TO bolsaram_app;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO bolsaram_app;
