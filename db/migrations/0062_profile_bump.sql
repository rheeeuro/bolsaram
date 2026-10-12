-- 0062: 프로필 끌어올리기
--
-- 등록한 주선자가 맡은 분을 목록 맨 앞으로 다시 올린다. 목록은 「최근에 올라온 순」인데
-- 지금까지 그 기준이 등록 시각 하나라, 오래전에 등록한 분은 뒤로 밀려 다시 앞에 세울
-- 방법이 없었다.
--
-- ── 정렬 키 ──────────────────────────────────────────────────
-- `bumped_at` 은 마지막으로 끌어올린 시각이고, 한 번도 안 했으면 NULL 이다.
-- 목록은 `COALESCE(bumped_at, created_at)` 으로 정렬한다(`@bolsaram/domain` 의
-- PROFILE_LISTED_AT_SQL). 등록 시각을 덮어쓰지 않는 것은 「언제 등록했나」가 운영
-- 정보로 따로 보이기 때문이다.
--
-- ── 누가, 얼마나 자주 ────────────────────────────────────────
-- 쓰기는 기존 `profiles_admin_update`(app_can_edit_profile) 그대로 **등록한 주선자만**.
-- 앱은 조건부 UPDATE 로 판정하지만, 런타임 롤은 테이블 단위 UPDATE 권한이 있어
-- 이 컬럼에 아무 값이나 넣을 수 있다. 그래서 트리거가 한 번 더 막는다.
--   - 값은 지금 시각뿐이다. 미래 시각을 넣으면 영원히 맨 앞에 남는다.
--   - 활성 프로필만. 멤버에게 안 보이는 분을 올리면 방에 알림만 남는다.
--   - 프로필당 24시간에 한 번. 같은 방 주선자들이 번갈아 올리기 시작하면 순서가
--     아무 뜻이 없어지고 채팅방이 끌어올림 알림으로 덮인다.
--   - 되돌리기(NULL)는 없다.
-- 24시간은 `PROFILE_BUMP_COOLDOWN_HOURS` 와 같은 값이다. 한쪽만 바꾸면 앱이 허락한
-- 끌어올리기를 DB 가 거절한다.
--
-- ── 채팅방에 남긴다 ──────────────────────────────────────────
-- 등록(PROFILE_REGISTERED)과 같은 방식이다 — 공개 번호와 주선자 이름만 적는다.
-- 전체공개 프로필은 방이 없으므로 남지 않는다(app_post_group_system_message 가 넘긴다).
-- 텔레그램으로는 보내지 않는다 — 시스템 메시지는 방 안의 배지로만 알린다(0044).

ALTER TYPE group_message_system_kind ADD VALUE 'PROFILE_BUMPED';

ALTER TABLE profiles ADD COLUMN bumped_at timestamptz;

ALTER TABLE profiles ADD CONSTRAINT profiles_bumped_after_created
  CHECK (bumped_at IS NULL OR bumped_at >= created_at);

COMMENT ON COLUMN profiles.bumped_at IS
  '마지막으로 끌어올린 시각. NULL 이면 한 번도 안 했다. 목록은 COALESCE(bumped_at, created_at) 순.';

-- ── 쓰기 가드 ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_profile_bump_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bumped_at IS NOT DISTINCT FROM OLD.bumped_at THEN
    RETURN NEW;
  END IF;
  IF NEW.bumped_at IS NULL THEN
    RAISE EXCEPTION '끌어올린 기록은 지울 수 없습니다.';
  END IF;
  IF NEW.bumped_at <> now() THEN
    RAISE EXCEPTION '끌어올린 시각은 지금 시각만 쓸 수 있습니다.';
  END IF;
  IF NEW.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '활성 프로필만 끌어올릴 수 있습니다.';
  END IF;
  IF OLD.bumped_at IS NOT NULL AND OLD.bumped_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION '끌어올리기는 24시간에 한 번입니다.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_profile_bump_guard() FROM PUBLIC;

CREATE TRIGGER profiles_bump_guard
  BEFORE UPDATE OF bumped_at ON profiles
  FOR EACH ROW EXECUTE FUNCTION app_profile_bump_guard();

-- ── 방에 남기기 ──────────────────────────────────────────────
--
-- 끌어올리는 사람은 언제나 등록한 주선자다(쓰기 정책). 그래도 이름은 지금 요청한
-- 사람에서 읽고, 세션이 없는 경로(owner)에서만 등록자로 대신한다.

CREATE OR REPLACE FUNCTION app_announce_profile_bumped() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_post_group_system_message(
    NEW.group_id,
    'PROFILE_BUMPED',
    jsonb_build_object(
      'profileCode', NEW.public_code,
      'actorName', (
        SELECT u.display_name FROM users u
         WHERE u.id = COALESCE(app_current_user_id(), NEW.created_by)
      )
    )
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_announce_profile_bumped() FROM PUBLIC;

CREATE TRIGGER profiles_announce_bumped
  AFTER UPDATE OF bumped_at ON profiles
  FOR EACH ROW WHEN (NEW.bumped_at IS DISTINCT FROM OLD.bumped_at)
  EXECUTE FUNCTION app_announce_profile_bumped();

-- ── 인덱스 ───────────────────────────────────────────────────
-- 정렬 키가 바뀌었으므로 탐색 인덱스를 같은 식으로 다시 만든다.
DROP INDEX profiles_discover_idx;
CREATE INDEX profiles_discover_idx
  ON profiles ((COALESCE(bumped_at, created_at)) DESC, id DESC)
  WHERE status = 'ACTIVE';
