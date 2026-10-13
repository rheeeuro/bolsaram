-- 0065: 관리자는 모든 모임·모든 프로필을 다룬다
--
-- 관리자는 주선자 위에 한 명 있는 운영자다. 어느 모임에도 **속하지 않고**(`group_admins`
-- 에 행이 없다) 대신 모든 모임과 모든 프로필에 모임장·등록한 주선자와 같은 권한을 갖는다.
-- 프로필 내용 수정, 「회원으로 보기」(대행), 신청 처리, 가져오기 검토, 모임 채팅, 모임 설정이
-- 모두 여기에 든다.
--
-- 관리자가 누구인지는 환경변수(`SEED_ADMIN_EMAIL1`)가 정하고, 인증 레이어가 그 값을
-- `operator_settings.operator_user_id` 에 맞춰 둔다(기동·로그인 때). RLS 는 이 칸 하나를
-- `app_is_operator()` 로 읽는다. 런타임 롤은 이 테이블을 직접 읽지 못하므로 함수는
-- SECURITY DEFINER 다.
--
-- 권한 판정은 이미 몇 개 함수에 모여 있다. 거기에 관리자 분기를 넣어 정책 전체가 함께
-- 따라오게 하고, 함수를 거치지 않고 `created_by` 를 직접 보던 정책 두 개만 다시 쓴다.

ALTER TABLE operator_settings
  ADD COLUMN operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE FUNCTION app_operator_user_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT operator_user_id FROM operator_settings
$$;
REVOKE ALL ON FUNCTION app_operator_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_operator_user_id() TO bolsaram_app;

CREATE FUNCTION app_is_operator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_admin()
     AND app_current_user_id() IS NOT NULL
     AND app_current_user_id() IS NOT DISTINCT FROM app_operator_user_id()
$$;
REVOKE ALL ON FUNCTION app_is_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_operator() TO bolsaram_app;

-- ── 핵심 판정 함수 ────────────────────────────────────────────

-- 모든 모임의 주선자처럼 본다. 모임을 읽고 고치는 정책, 채팅, 알림 설정이 이 함수를 쓴다.
CREATE OR REPLACE FUNCTION app_is_group_admin(target_group uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_is_admin() AND (
    app_is_operator()
    OR EXISTS (
      SELECT 1 FROM group_admins ga
       WHERE ga.group_id = target_group AND ga.user_id = app_current_user_id()
    )
  )
$$;

-- 모든 프로필을 등록한 주선자처럼 다룬다. 수정·사진·메모·초대·신청 처리·대행
-- (`app_current_profile_id`)·이름과 연락처 공개가 모두 이 함수를 지난다.
CREATE OR REPLACE FUNCTION app_can_edit_profile(target_profile uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = target_profile
       AND app_is_admin()
       AND (
         app_is_operator()
         OR (p.created_by = app_current_user_id()
             AND (p.group_id IS NULL OR app_is_group_admin(p.group_id)))
       )
  )
$$;

CREATE OR REPLACE FUNCTION app_can_edit_import(target_session uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM import_sessions s
     WHERE s.id = target_session
       AND app_is_admin()
       AND (
         app_is_operator()
         OR (s.created_by = app_current_user_id()
             AND (s.group_id IS NULL OR app_is_group_admin(s.group_id)))
       )
  )
$$;

-- 관리자는 합류한 시점이 없다 — 모든 방의 처음부터 본다.
CREATE OR REPLACE FUNCTION app_group_chat_visible_from(target_group uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT date_trunc('milliseconds', ga.added_at)
       FROM group_admins ga
      WHERE ga.group_id = target_group AND ga.user_id = app_current_user_id()),
    CASE WHEN app_is_operator() THEN '-infinity'::timestamptz END
  )
$$;

-- 방에 남는 사건의 「누가」. 관리자가 한 일도 관리자 이름으로 남는다.
CREATE OR REPLACE FUNCTION app_group_chat_actor(target_group uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT ga.user_id
       FROM group_admins ga
      WHERE ga.group_id = target_group AND ga.user_id = app_current_user_id()),
    CASE WHEN app_is_operator() THEN app_current_user_id() END
  )
$$;

-- 알림 받을 담당. 관리자가 등록한 프로필은 모임에 속하지 않아도 관리자가 받는다.
CREATE OR REPLACE FUNCTION app_profile_admins(target_profile uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.created_by
    FROM profiles p
   WHERE p.id = target_profile
     AND p.created_by IS NOT NULL
     AND (
       p.group_id IS NULL
       OR p.created_by IS NOT DISTINCT FROM app_operator_user_id()
       OR EXISTS (SELECT 1 FROM group_admins ga
                   WHERE ga.group_id = p.group_id AND ga.user_id = p.created_by)
     )
$$;

-- ── created_by 를 직접 보던 정책 ──────────────────────────────

-- 수정 뒤 행도 관리자면 통과한다. 남이 등록한 프로필을 고쳐도 등록자는 그대로다.
DROP POLICY profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (app_can_edit_profile(id))
  WITH CHECK (
    app_is_admin() AND (
      app_is_operator()
      OR (created_by = app_current_user_id()
          AND (group_id IS NULL OR app_is_group_admin(group_id)))
    )
  );

-- 관리자가 남이 가져온 원본을 등록하면 등록자는 원본을 만든 주선자로 남는다.
DROP POLICY profiles_admin_write ON profiles;
CREATE POLICY profiles_admin_write ON profiles FOR INSERT
  WITH CHECK (
    app_is_admin() AND (
      app_is_operator()
      OR (created_by = app_current_user_id()
          AND (group_id IS NULL OR app_is_group_admin(group_id)))
    )
  );

DROP POLICY import_sessions_admin ON import_sessions;
CREATE POLICY import_sessions_admin ON import_sessions FOR ALL
  USING (
    app_is_admin() AND (
      app_is_operator()
      OR (created_by = app_current_user_id()
          AND (group_id IS NULL OR app_is_group_admin(group_id)))
    )
  )
  WITH CHECK (
    app_is_admin() AND (
      app_is_operator()
      OR (created_by = app_current_user_id()
          AND (group_id IS NULL OR app_is_group_admin(group_id)))
    )
  );

-- ── 관리자는 모임에 속하지 않는다 ─────────────────────────────

CREATE FUNCTION app_reject_operator_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT DISTINCT FROM (SELECT operator_user_id FROM operator_settings) THEN
    RAISE EXCEPTION '관리자는 모임에 속하지 않습니다 — 모든 모임에 이미 접근합니다.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER group_admins_reject_operator BEFORE INSERT OR UPDATE OF user_id ON group_admins
  FOR EACH ROW EXECUTE FUNCTION app_reject_operator_membership();

-- 관리자의 기존 소속을 걷어낼 때(인증 레이어의 동기화) 「나가기」의 뒷정리를 하지 않는다.
-- 관리자는 계속 그 모임을 다루므로 등록한 프로필을 비활성으로 돌리거나, 보고 있는 모임·
-- 봇이 담을 모임을 비우거나, 방에 「나갔습니다」를 남길 이유가 없다.

CREATE OR REPLACE FUNCTION deactivate_profiles_on_leave() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.user_id IS NOT DISTINCT FROM (SELECT operator_user_id FROM operator_settings) THEN
    RETURN OLD;
  END IF;
  UPDATE profiles
     SET status = 'INACTIVE'
   WHERE group_id = OLD.group_id
     AND created_by = OLD.user_id
     AND status = 'ACTIVE';
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION clear_active_group_on_leave() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.user_id IS NOT DISTINCT FROM (SELECT operator_user_id FROM operator_settings) THEN
    RETURN OLD;
  END IF;
  UPDATE users
     SET active_group_id = NULL
   WHERE id = OLD.user_id AND active_group_id = OLD.group_id;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION clear_telegram_upload_group_on_leave() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.user_id IS NOT DISTINCT FROM (SELECT operator_user_id FROM operator_settings) THEN
    RETURN OLD;
  END IF;
  UPDATE telegram_connections
     SET upload_group_id = NULL
   WHERE user_id = OLD.user_id AND upload_group_id = OLD.group_id;
  RETURN OLD;
END
$$;

CREATE OR REPLACE FUNCTION app_announce_group_admin_left() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed_by uuid := nullif(current_setting('app.group_admin_removed_by', true), '')::uuid;
BEGIN
  IF OLD.user_id IS NOT DISTINCT FROM (SELECT operator_user_id FROM operator_settings) THEN
    RETURN OLD;
  END IF;
  -- 자기 자신을 지우는 경로는 내보내기가 아니다. 값이 남아 있어도 탈퇴로 읽는다.
  IF removed_by IS NOT NULL AND removed_by <> OLD.user_id THEN
    PERFORM app_post_group_system_message(
      OLD.group_id,
      'ADMIN_REMOVED',
      jsonb_build_object(
        'actorName', (SELECT u.display_name FROM users u WHERE u.id = removed_by),
        'targetName', (SELECT u.display_name FROM users u WHERE u.id = OLD.user_id)
      )
    );
  ELSE
    PERFORM app_post_group_system_message(
      OLD.group_id,
      'ADMIN_LEFT',
      jsonb_build_object(
        'actorName', (SELECT u.display_name FROM users u WHERE u.id = OLD.user_id)
      )
    );
  END IF;
  RETURN OLD;
END $$;
