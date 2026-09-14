-- 0046: 모임장이 하는 일을 방에 구분해 남긴다
--
-- 지금까지 `is_owner` 는 화면의 「개설자」 배지에만 쓰였고, 모임장이 할 수 있는 일이
-- 따로 없었다. 그래서 **잘못 들어온 주선자를 뺄 방법이 없었다** — 초대 코드가 잘못
-- 전달되면 그 사람이 스스로 나가기 전까지 그 모임 회원의 이름·연락처·사진에 계속
-- 닿는다. 모임장에게 위임과 내보내기를 준다.
--
-- ── 권한은 여기서 열지 않는다 ────────────────────────────────
-- `group_admins` 에는 여전히 SELECT 정책만 둔다(0010). 소속을 바꾸는 것은 데이터가
-- 아니라 신원에 가깝고, 인증 레이어의 owner 커넥션만이 한다. 이 마이그레이션이
-- 하는 일은 **그 사건을 방에 어떻게 적을 것인가**뿐이다.
--
-- ── 나간 것과 내보내진 것을 구분한다 ─────────────────────────
-- 트리거는 DELETE 한 줄만 보므로 자진 탈퇴와 내보내기를 스스로 구분할 수 없다.
-- 내보내는 경로가 트랜잭션 지역 GUC `app.group_admin_removed_by` 에 실행한 사람을
-- 적고, 트리거가 그 값으로 갈라 쓴다. 값이 없으면 지금까지대로 ADMIN_LEFT 다.

ALTER TYPE group_message_system_kind ADD VALUE 'ADMIN_REMOVED';
ALTER TYPE group_message_system_kind ADD VALUE 'OWNER_TRANSFERRED';

-- ── 퇴장: 나간 것인가 내보내진 것인가 ────────────────────────
--
-- payload 의 이름 규칙은 0044 그대로다 — `actorName` 이 그 일을 한 사람이고,
-- 내보내기에서만 대상이 따로 있으므로 `targetName` 이 붙는다. 나간 주선자는 나중에
-- `users` 를 읽을 수 없으니(같은 모임이 아니다) 이 순간의 이름을 적어 둔다.
CREATE OR REPLACE FUNCTION app_announce_group_admin_left() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed_by uuid := nullif(current_setting('app.group_admin_removed_by', true), '')::uuid;
BEGIN
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
REVOKE ALL ON FUNCTION app_announce_group_admin_left() FROM PUBLIC;

-- ── 모임장이 바뀌었다 ────────────────────────────────────────
--
-- 넘긴 사람이 아니라 **받은 사람**을 적는다. 같은 트랜잭션에서 이전 모임장은 이미
-- `is_owner = false` 라 트리거가 그를 찾을 수 없고, 방에서 읽을 때 필요한 것도
-- 「지금 누가 모임장인가」다. 마지막 주선자가 나가며 자동으로 승계되는 경우(0010)도
-- 같은 줄로 남는다 — 사람이 넘긴 것과 구분할 이유가 없다.
CREATE OR REPLACE FUNCTION app_announce_group_owner_transferred() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_post_group_system_message(
    NEW.group_id,
    'OWNER_TRANSFERRED',
    jsonb_build_object(
      'actorName', (SELECT u.display_name FROM users u WHERE u.id = NEW.user_id)
    )
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_announce_group_owner_transferred() FROM PUBLIC;

CREATE TRIGGER group_admins_announce_owner
  AFTER UPDATE OF is_owner ON group_admins
  FOR EACH ROW WHEN (NEW.is_owner AND NOT OLD.is_owner)
  EXECUTE FUNCTION app_announce_group_owner_transferred();
