-- 0010: 모임(테넌트) 격리
--
-- 지금까지 관리자 정책은 `app_is_admin()` 하나로만 판정했다. ADMIN 계정이 하나
-- 생기면 전체 회원의 이름·연락처·사진에 접근할 수 있었고, 주선자 자유 가입을 붙이면
-- 누구나 남의 회원 정보를 볼 수 있었다.
--
-- 모임을 도입해 격리한다.
--   * 회원(profiles)은 모임에 속한다.
--   * 주선자는 자기가 속한 모임의 데이터만 다룬다(group_admins).
--   * 회원의 Discover 도 자기 모임 안에서만 보인다.
--
-- 판정은 GUC 를 새로 만들지 않고 `group_admins` 를 직접 조회하는 SECURITY DEFINER
-- 함수로 한다 — 애플리케이션이 그룹을 스스로 주장할 수 없게 하려는 것이다.

CREATE TABLE groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- 만든 주선자. 계정이 지워져도 모임은 남는다(다른 주선자가 있을 수 있다).
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER groups_set_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 주선자 ↔ 모임. 한 모임에 여러 주선자가 들어간다.
CREATE TABLE group_admins (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- OWNER 는 모임을 만든 사람. 주선자 초대·제거 권한 판정에 쓴다.
  is_owner boolean NOT NULL DEFAULT false,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_admins_user_idx ON group_admins (user_id);
-- 모임마다 OWNER 는 한 명.
CREATE UNIQUE INDEX group_admins_one_owner ON group_admins (group_id) WHERE is_owner;

-- ── 소속 컬럼 ────────────────────────────────────────────────
-- 우선 nullable 로 넣고 기존 데이터를 이관한 뒤 NOT NULL 로 조인다.
ALTER TABLE profiles ADD COLUMN group_id uuid REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE import_sessions ADD COLUMN group_id uuid REFERENCES groups(id) ON DELETE CASCADE;

-- ── 기존 데이터 이관 ─────────────────────────────────────────
-- 지금 있는 주선자 전원과 모든 회원을 기본 모임 하나에 넣는다.
-- 이 배포는 아직 실제 서비스 전이고 주선자가 한 팀이었으므로 이 이관이 의도와 맞는다.
DO $$
DECLARE
  default_group uuid;
  first_admin   uuid;
BEGIN
  SELECT id INTO first_admin FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1;

  INSERT INTO groups (name, created_by) VALUES ('기본 모임', first_admin)
  RETURNING id INTO default_group;

  INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
  SELECT default_group, u.id, u.id = first_admin, first_admin
    FROM users u WHERE u.role = 'ADMIN';

  UPDATE profiles SET group_id = default_group WHERE group_id IS NULL;
  UPDATE import_sessions SET group_id = default_group WHERE group_id IS NULL;
END
$$;

ALTER TABLE profiles ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE import_sessions ALTER COLUMN group_id SET NOT NULL;
CREATE INDEX profiles_group_idx ON profiles (group_id, status, visibility);
CREATE INDEX import_sessions_group_idx ON import_sessions (group_id, created_at DESC);

-- ── 판정 함수 ────────────────────────────────────────────────

/** 현재 사용자가 이 모임의 주선자인가. */
CREATE OR REPLACE FUNCTION app_is_group_admin(target_group uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_admin() AND EXISTS (
    SELECT 1 FROM group_admins ga
     WHERE ga.group_id = target_group AND ga.user_id = app_current_user_id()
  )
$$;
REVOKE ALL ON FUNCTION app_is_group_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_group_admin(uuid) TO bolsaram_app;

/** 현재 회원(=자기 프로필)이 속한 모임. 주선자에게는 NULL 이다. */
CREATE OR REPLACE FUNCTION app_current_member_group() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT group_id FROM profiles WHERE user_id = app_current_user_id()
$$;
REVOKE ALL ON FUNCTION app_current_member_group() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_member_group() TO bolsaram_app;

/** 이 프로필을 현재 사용자가 다룰 수 있는가(주선자) — 조인을 줄이기 위한 헬퍼. */
CREATE OR REPLACE FUNCTION app_can_admin_profile(target_profile uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = target_profile AND app_is_group_admin(p.group_id)
  )
$$;
REVOKE ALL ON FUNCTION app_can_admin_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_admin_profile(uuid) TO bolsaram_app;

-- ── groups / group_admins 정책 ───────────────────────────────
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_read ON groups FOR SELECT
  USING (app_is_group_admin(id) OR id = app_current_member_group());
CREATE POLICY groups_owner_update ON groups FOR UPDATE
  USING (app_is_group_admin(id)) WITH CHECK (app_is_group_admin(id));

ALTER TABLE group_admins ENABLE ROW LEVEL SECURITY;
-- 같은 모임의 주선자 목록만 본다.
CREATE POLICY group_admins_read ON group_admins FOR SELECT
  USING (app_is_group_admin(group_id));
-- 주선자 추가·제거는 인증 레이어(owner 커넥션)에서만 한다. 정책을 주지 않는다.

GRANT SELECT, UPDATE ON groups TO bolsaram_app;
GRANT SELECT ON group_admins TO bolsaram_app;

-- ── 기존 정책 재작성 ─────────────────────────────────────────
-- 관리자 조건을 전부 "그 모임의 주선자인가"로 좁힌다.

DROP POLICY profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (
    app_is_group_admin(group_id)
    OR user_id = app_current_user_id()
    -- 회원은 **자기 모임 안의** 공개 프로필만 본다.
    OR (
      group_id = app_current_member_group()
      AND status IN ('ACTIVE','MATCHING')
      AND visibility <> 'PRIVATE'
    )
  );

DROP POLICY profiles_admin_write ON profiles;
CREATE POLICY profiles_admin_write ON profiles FOR INSERT
  WITH CHECK (app_is_group_admin(group_id));

DROP POLICY profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (app_is_group_admin(group_id)) WITH CHECK (app_is_group_admin(group_id));

DROP POLICY profiles_admin_delete ON profiles;
CREATE POLICY profiles_admin_delete ON profiles FOR DELETE
  USING (app_is_group_admin(group_id));

-- profiles_claim 은 그대로 둔다(주인 없는 프로필을 본인에게 연결). 모임은 초대가 정한다.

DROP POLICY profile_images_read ON profile_images;
CREATE POLICY profile_images_read ON profile_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_id));
DROP POLICY profile_images_admin_write ON profile_images;
CREATE POLICY profile_images_admin_write ON profile_images FOR ALL
  USING (app_can_admin_profile(profile_id))
  WITH CHECK (app_can_admin_profile(profile_id));

DROP POLICY match_requests_read ON match_requests;
CREATE POLICY match_requests_read ON match_requests FOR SELECT
  USING (
    app_can_admin_profile(requester_profile_id)
    OR requester_profile_id = app_current_profile_id()
    OR target_profile_id = app_current_profile_id()
  );

DROP POLICY match_requests_create ON match_requests;
CREATE POLICY match_requests_create ON match_requests FOR INSERT
  WITH CHECK (
    requester_profile_id = app_current_profile_id()
    AND target_profile_id <> app_current_profile_id()
    -- 모임을 넘는 신청은 만들 수 없다.
    AND EXISTS (
      SELECT 1 FROM profiles t
       WHERE t.id = target_profile_id AND t.group_id = app_current_member_group()
    )
  );

DROP POLICY match_requests_admin_update ON match_requests;
CREATE POLICY match_requests_admin_update ON match_requests FOR UPDATE
  USING (app_can_admin_profile(requester_profile_id))
  WITH CHECK (app_can_admin_profile(requester_profile_id));

DROP POLICY invites_admin ON invites;
CREATE POLICY invites_admin ON invites FOR ALL
  USING (app_can_admin_profile(profile_id))
  WITH CHECK (app_can_admin_profile(profile_id));

DROP POLICY import_sessions_admin ON import_sessions;
CREATE POLICY import_sessions_admin ON import_sessions FOR ALL
  USING (app_is_group_admin(group_id)) WITH CHECK (app_is_group_admin(group_id));

DROP POLICY import_assets_admin ON import_assets;
CREATE POLICY import_assets_admin ON import_assets FOR ALL
  USING (EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = import_session_id AND app_is_group_admin(s.group_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = import_session_id AND app_is_group_admin(s.group_id)
  ));

DROP POLICY import_extractions_admin ON import_extractions;
CREATE POLICY import_extractions_admin ON import_extractions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = import_session_id AND app_is_group_admin(s.group_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = import_session_id AND app_is_group_admin(s.group_id)
  ));

-- 텔레그램 연결은 주선자 개인 것이다. 같은 모임 주선자에게도 보이지 않는다.
DROP POLICY telegram_connections_admin ON telegram_connections;
CREATE POLICY telegram_connections_own ON telegram_connections FOR ALL
  USING (user_id = app_current_user_id() AND app_is_admin())
  WITH CHECK (user_id = app_current_user_id() AND app_is_admin());

DROP POLICY telegram_import_sessions_admin ON telegram_import_sessions;
CREATE POLICY telegram_import_sessions_admin ON telegram_import_sessions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = import_session_id AND app_is_group_admin(s.group_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = import_session_id AND app_is_group_admin(s.group_id)
  ));

-- users: 관리자가 남의 계정을 마음대로 보지 않게 좁힌다.
-- 같은 모임의 회원과 주선자만 조회할 수 있다.
DROP POLICY users_self_select ON users;
CREATE POLICY users_self_select ON users FOR SELECT
  USING (
    id = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM profiles p
       WHERE p.user_id = users.id AND app_is_group_admin(p.group_id)
    )
    OR EXISTS (
      SELECT 1 FROM group_admins ga
       WHERE ga.user_id = users.id AND app_is_group_admin(ga.group_id)
    )
  );

DROP POLICY users_self_update ON users;
CREATE POLICY users_self_update ON users FOR UPDATE
  USING (id = app_current_user_id()) WITH CHECK (id = app_current_user_id());

-- 계정 생성은 인증 레이어(owner)에서만 한다. 관리자 정책을 없앤다.
DROP POLICY users_admin_insert ON users;

-- audit_logs 열람은 자기 모임 관련 기록으로 좁히기 어렵다(entity_type 이 여러 종류다).
-- 우선 본인이 남긴 기록만 보게 한다 — 넓히려면 그때 근거를 정한다.
DROP POLICY audit_logs_admin_read ON audit_logs;
CREATE POLICY audit_logs_own_read ON audit_logs FOR SELECT
  USING (actor_user_id = app_current_user_id());
