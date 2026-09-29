-- 0056: 프로필과 Import 는 **등록한 주선자만** 다룬다 — 모임 안에서도
--
-- 모임은 「누가 보는가」의 경계이고 「누가 다루는가」의 경계가 아니다. 같은 모임
-- 주선자는 서로의 프로필을 보지만, 고치기·초대 링크·대신 둘러보기·신청 처리·
-- Import 검토는 그 프로필을 올린 사람만 한다. 초대 링크는 그 멤버의 로그인 수단이고
-- 대신 둘러보기는 그 멤버의 이름으로 마음을 보낼 수 있어서, 담당이 아닌 사람이
-- 할 수 있으면 안 된다. 전체공개 프로필에 이미 쓰던 규칙을 모임에도 그대로 쓴다.
--
-- 판정은 한 곳이다: `app_can_edit_profile`. 초대·대행·사진·신청·요청 정책이
-- 모두 이 함수를 부르므로 함수만 바꾸면 따라온다. 담당 주선자에게 가는 알림의
-- 받는 사람(`app_profile_admins`)도 같은 기준으로 좁힌다.
--
-- 모임에서 나가거나 내보내진 주선자가 올린 그 모임의 프로필은 **비활성**이 된다.
-- 다룰 사람이 없는 프로필이 멤버 목록에 남아 신청을 받으면 아무도 답할 수 없다.
-- 다시 들어오면 그 주선자가 직접 활성으로 되돌린다.

-- ── 판정 ────────────────────────────────────────────────────────
-- 모임 프로필은 등록한 사람이 **지금도 그 모임에 속해 있을 때만** 다룬다.
CREATE OR REPLACE FUNCTION app_can_edit_profile(target_profile uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = target_profile
       AND app_is_admin()
       AND p.created_by = app_current_user_id()
       AND (p.group_id IS NULL OR app_is_group_admin(p.group_id))
  )
$$;

-- 0010 의 옛 판정. 부르는 곳은 없지만 더 넓은 기준이 남아 있지 않게 맞춘다.
CREATE OR REPLACE FUNCTION app_can_admin_profile(target_profile uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_can_edit_profile(target_profile)
$$;

CREATE OR REPLACE FUNCTION app_can_edit_import(target_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = target_session
       AND app_is_admin()
       AND s.created_by = app_current_user_id()
       AND (s.group_id IS NULL OR app_is_group_admin(s.group_id))
  )
$$;

-- ── 정책 ────────────────────────────────────────────────────────
-- Import 세션은 함수가 아니라 식을 직접 쓰고 있었다.
DROP POLICY import_sessions_admin ON import_sessions;
CREATE POLICY import_sessions_admin ON import_sessions FOR ALL
  USING (
    app_is_admin()
    AND created_by = app_current_user_id()
    AND (group_id IS NULL OR app_is_group_admin(group_id))
  )
  WITH CHECK (
    app_is_admin()
    AND created_by = app_current_user_id()
    AND (group_id IS NULL OR app_is_group_admin(group_id))
  );

-- 등록자가 곧 담당이므로 `created_by` 를 남의 것으로 쓰거나 바꿀 수 없어야 한다.
DROP POLICY profiles_admin_write ON profiles;
CREATE POLICY profiles_admin_write ON profiles FOR INSERT
  WITH CHECK (
    app_is_admin()
    AND created_by = app_current_user_id()
    AND (group_id IS NULL OR app_is_group_admin(group_id))
  );

DROP POLICY profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (app_can_edit_profile(id))
  WITH CHECK (
    app_is_admin()
    AND created_by = app_current_user_id()
    AND (group_id IS NULL OR app_is_group_admin(group_id))
  );

-- ── 알림 받는 사람 ─────────────────────────────────────────────
-- 담당 = 등록한 주선자. 모임 프로필이면 그 사람이 아직 그 모임에 있을 때만.
CREATE OR REPLACE FUNCTION app_profile_admins(target_profile uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.created_by
    FROM profiles p
   WHERE p.id = target_profile
     AND p.created_by IS NOT NULL
     AND (
       p.group_id IS NULL
       OR EXISTS (SELECT 1 FROM group_admins ga
                   WHERE ga.group_id = p.group_id AND ga.user_id = p.created_by)
     )
$$;

-- ── 나가면 비활성 ──────────────────────────────────────────────
-- 나가기·내보내기 모두 `group_admins` 행 삭제이므로 트리거 하나로 둘 다 잡는다.
CREATE OR REPLACE FUNCTION deactivate_profiles_on_leave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles
     SET status = 'INACTIVE'
   WHERE group_id = OLD.group_id
     AND created_by = OLD.user_id
     AND status = 'ACTIVE';
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION deactivate_profiles_on_leave() FROM PUBLIC;

CREATE TRIGGER group_admins_deactivate_profiles
  AFTER DELETE ON group_admins
  FOR EACH ROW EXECUTE FUNCTION deactivate_profiles_on_leave();
