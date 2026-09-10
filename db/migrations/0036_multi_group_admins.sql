-- 0036: 주선자 다중 모임 소속 + 활성 모임(채널)
--
-- `group_admins` 는 처음부터 (group_id, user_id) 복합 PK 라 한 주선자가 여러 모임에
-- 들어가는 것을 스키마가 이미 허용한다. 막고 있던 것은 애플리케이션 레이어였다 —
-- 가입·초대 소비가 "이미 모임에 속해 있으면 거절" 했고, 세션은 `LIMIT 1` 로 첫
-- 모임만 읽었다. 그 제약을 걷어내면 카카오톡 단톡방·디스코드 채널처럼 한 사람이
-- 여러 모임을 오가며 일할 수 있다.
--
-- 그러려면 **지금 어느 모임에서 일하고 있는가**를 어딘가 담아야 한다. 그것이
-- `users.active_group_id` 다.
--
--   NULL            → 전체공개 채널. 소속 없는 프로필(group_id IS NULL)을 다룬다.
--   NOT NULL        → 그 모임 채널.
--
-- **이 값은 권한이 아니라 화면 필터다.** RLS 는 여기를 보지 않는다 — 정책은 여전히
-- `group_admins` 를 직접 조회하는 `app_is_group_admin()` 으로 판정한다. 그래서 앱이
-- 이 값을 어떻게 바꾸든 볼 수 있는 범위는 늘어나지 않는다(속하지 않은 모임을 넣고
-- 프로필을 만들려 하면 `profiles_admin_write` 가 막는다). 애플리케이션도 세션을 읽을
-- 때마다 실제 소속인지 다시 확인하고, 아니면 전체공개로 떨어뜨린다.
--
-- 세션이 아니라 계정에 두는 이유: 텔레그램 봇에는 세션이 없다. 봇이 만드는 Import 가
-- 웹에서 보고 있는 채널과 같은 곳으로 들어가야 "지금 이 방에서 일한다"는 감각이 맞다.

ALTER TABLE users ADD COLUMN active_group_id uuid REFERENCES groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN users.active_group_id IS
  '주선자가 지금 보고 있는 모임(채널). NULL 이면 전체공개. 권한이 아니라 화면 필터이며 RLS 는 이 값을 보지 않는다.';

-- 지금까지는 첫 모임 하나만 쓰고 있었다. 그 모임을 그대로 활성 채널로 옮겨
-- 이번 배포에서 보이는 화면이 달라지지 않게 한다.
UPDATE users u
   SET active_group_id = (
         SELECT ga.group_id FROM group_admins ga
          WHERE ga.user_id = u.id ORDER BY ga.added_at LIMIT 1
       )
 WHERE u.role = 'ADMIN';

-- ── 소속이 끊기면 활성 채널도 따라 끊는다 ────────────────────
--
-- 모임 삭제는 위 FK 의 ON DELETE SET NULL 이 처리한다. 남는 것은 **나가기** 다 —
-- `group_admins` 행만 사라지고 `users.active_group_id` 는 그 모임을 가리킨 채 남는다.
-- 애플리케이션에서도 지우지만(권한 검사는 두 곳에 중복으로) 트리거로 한 번 더 잠근다.
CREATE OR REPLACE FUNCTION clear_active_group_on_leave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE users
     SET active_group_id = NULL
   WHERE id = OLD.user_id AND active_group_id = OLD.group_id;
  RETURN OLD;
END
$$;

CREATE TRIGGER group_admins_clear_active_group
  AFTER DELETE ON group_admins
  FOR EACH ROW EXECUTE FUNCTION clear_active_group_on_leave();

-- ── 활성 채널은 앱 롤이 바꾸지 않는다 ────────────────────────
--
-- 모임 소속과 마찬가지로 채널 전환은 인증 레이어(owner 커넥션)만 한다.
-- `users` 에는 `users_self_update` 정책이 있어 본인 행을 고칠 수 있으므로,
-- 컬럼 단위로 UPDATE 권한을 다시 그어 이 컬럼만 뺀다.
REVOKE UPDATE ON users FROM bolsaram_app;
GRANT UPDATE (email, phone, display_name, password_hash, last_login_at, updated_at)
  ON users TO bolsaram_app;
