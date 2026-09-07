-- 0011: 전체공개 풀 — 모임 소속을 선택으로
--
-- 0010 은 모든 프로필을 모임에 강제로 넣었다. 그래서 갓 가입한 주선자는 빈 화면만
-- 봤다. 주선자와 모임을 분리하고, **모임에 소속되지 않은 프로필을 전체공개로** 둔다.
--
--   group_id IS NULL      → 전체공개. 모든 주선자가 본다.
--   group_id IS NOT NULL  → 그 모임 전용.
--
-- 공개 여부를 별도 컬럼으로 두지 않는다 — 소속 여부가 곧 공개 여부다. 두 축으로
-- 나누면 "모임 소속인데 전체공개" 같은 모순 상태가 생긴다.
--
-- 읽기와 쓰기를 다르게 준다. 전체공개 프로필은 누구나 **보지만**, 고치는 것은
-- 등록한 주선자만이다. 아무 주선자나 남이 등록한 프로필을 고치면 안 된다.

ALTER TABLE profiles ALTER COLUMN group_id DROP NOT NULL;
ALTER TABLE import_sessions ALTER COLUMN group_id DROP NOT NULL;

-- 전체공개 풀 조회용. 부분 인덱스로 NULL 만 모은다.
CREATE INDEX profiles_public_idx ON profiles (status, visibility) WHERE group_id IS NULL;

-- ── 판정 함수 ────────────────────────────────────────────────

/**
 * 주선자가 이 프로필을 **볼** 수 있는가.
 * 전체공개(소속 없음)이거나 자기 모임 것이면 본다.
 */
CREATE OR REPLACE FUNCTION app_can_view_profile_as_admin(target_group uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_is_admin() AND (target_group IS NULL OR app_is_group_admin(target_group))
$$;
REVOKE ALL ON FUNCTION app_can_view_profile_as_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_view_profile_as_admin(uuid) TO bolsaram_app;

/**
 * 주선자가 이 프로필을 **고칠** 수 있는가.
 * 자기 모임 것이거나, 전체공개인데 자기가 등록한 것이면 고친다.
 */
CREATE OR REPLACE FUNCTION app_can_edit_profile(target_profile uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = target_profile
       AND (
         app_is_group_admin(p.group_id)
         OR (p.group_id IS NULL AND app_is_admin() AND p.created_by = app_current_user_id())
       )
  )
$$;
REVOKE ALL ON FUNCTION app_can_edit_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_edit_profile(uuid) TO bolsaram_app;

/**
 * 주선자가 이 Import 세션을 다룰 수 있는가.
 * 소속 없는 세션은 만든 사람만 다룬다.
 */
CREATE OR REPLACE FUNCTION app_can_edit_import(target_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = target_session
       AND (
         app_is_group_admin(s.group_id)
         OR (s.group_id IS NULL AND app_is_admin() AND s.created_by = app_current_user_id())
       )
  )
$$;
REVOKE ALL ON FUNCTION app_can_edit_import(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_edit_import(uuid) TO bolsaram_app;

-- ── profiles ────────────────────────────────────────────────
DROP POLICY profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (
    app_can_view_profile_as_admin(group_id)
    OR user_id = app_current_user_id()
    -- 회원은 **자기와 같은 풀** 안의 공개 프로필만 본다.
    -- IS NOT DISTINCT FROM 이라 전체공개 회원끼리도 서로 보인다(둘 다 NULL).
    OR (
      app_current_profile_id() IS NOT NULL
      AND group_id IS NOT DISTINCT FROM app_current_member_group()
      AND status IN ('ACTIVE','MATCHING')
      AND visibility <> 'PRIVATE'
    )
  );

DROP POLICY profiles_admin_write ON profiles;
CREATE POLICY profiles_admin_write ON profiles FOR INSERT
  WITH CHECK (
    -- 자기 모임에 넣거나, 소속 없이(전체공개) 자기 명의로 만든다.
    app_is_group_admin(group_id)
    OR (group_id IS NULL AND app_is_admin() AND created_by = app_current_user_id())
  );

DROP POLICY profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (app_can_edit_profile(id))
  WITH CHECK (
    app_is_group_admin(group_id)
    OR (group_id IS NULL AND app_is_admin() AND created_by = app_current_user_id())
  );

DROP POLICY profiles_admin_delete ON profiles;
CREATE POLICY profiles_admin_delete ON profiles FOR DELETE
  USING (app_can_edit_profile(id));

-- ── 프로필에 딸린 것들 ──────────────────────────────────────
DROP POLICY profile_images_admin_write ON profile_images;
CREATE POLICY profile_images_admin_write ON profile_images FOR ALL
  USING (app_can_edit_profile(profile_id))
  WITH CHECK (app_can_edit_profile(profile_id));

DROP POLICY invites_admin ON invites;
CREATE POLICY invites_admin ON invites FOR ALL
  USING (app_can_edit_profile(profile_id))
  WITH CHECK (app_can_edit_profile(profile_id));

DROP POLICY match_requests_read ON match_requests;
CREATE POLICY match_requests_read ON match_requests FOR SELECT
  USING (
    app_can_edit_profile(requester_profile_id)
    OR requester_profile_id = app_current_profile_id()
    OR target_profile_id = app_current_profile_id()
  );

DROP POLICY match_requests_create ON match_requests;
CREATE POLICY match_requests_create ON match_requests FOR INSERT
  WITH CHECK (
    requester_profile_id = app_current_profile_id()
    AND target_profile_id <> app_current_profile_id()
    -- 풀을 넘는 신청은 만들 수 없다(모임 ↔ 전체공개 사이도 막힌다).
    AND EXISTS (
      SELECT 1 FROM profiles t
       WHERE t.id = target_profile_id
         AND t.group_id IS NOT DISTINCT FROM app_current_member_group()
    )
  );

DROP POLICY match_requests_admin_update ON match_requests;
CREATE POLICY match_requests_admin_update ON match_requests FOR UPDATE
  USING (app_can_edit_profile(requester_profile_id))
  WITH CHECK (app_can_edit_profile(requester_profile_id));

-- ── import_* ────────────────────────────────────────────────
DROP POLICY import_sessions_admin ON import_sessions;
CREATE POLICY import_sessions_admin ON import_sessions FOR ALL
  USING (
    app_is_group_admin(group_id)
    OR (group_id IS NULL AND app_is_admin() AND created_by = app_current_user_id())
  )
  WITH CHECK (
    app_is_group_admin(group_id)
    OR (group_id IS NULL AND app_is_admin() AND created_by = app_current_user_id())
  );

DROP POLICY import_assets_admin ON import_assets;
CREATE POLICY import_assets_admin ON import_assets FOR ALL
  USING (app_can_edit_import(import_session_id))
  WITH CHECK (app_can_edit_import(import_session_id));

DROP POLICY import_extractions_admin ON import_extractions;
CREATE POLICY import_extractions_admin ON import_extractions FOR ALL
  USING (app_can_edit_import(import_session_id))
  WITH CHECK (app_can_edit_import(import_session_id));

DROP POLICY telegram_import_sessions_admin ON telegram_import_sessions;
CREATE POLICY telegram_import_sessions_admin ON telegram_import_sessions FOR ALL
  USING (app_can_edit_import(import_session_id))
  WITH CHECK (app_can_edit_import(import_session_id));

-- ── users ───────────────────────────────────────────────────
-- 전체공개 프로필의 주인 계정까지 모든 주선자에게 보이면 안 된다.
-- 이름·연락처 공개는 여전히 연결(INTRODUCED) 이후에만이며, 그 판정은 도메인
-- 레이어(projectProfile)가 한다. 여기서는 계정 행 자체의 접근만 좁혀 둔다.
DROP POLICY users_self_select ON users;
CREATE POLICY users_self_select ON users FOR SELECT
  USING (
    id = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM profiles p
       WHERE p.user_id = users.id AND app_can_edit_profile(p.id)
    )
    OR EXISTS (
      SELECT 1 FROM group_admins ga
       WHERE ga.user_id = users.id AND app_is_group_admin(ga.group_id)
    )
  );
