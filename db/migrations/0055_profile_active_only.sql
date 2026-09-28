-- 0055: 프로필 상태는 활성/비활성 둘뿐이다
--
-- 프로필 한 사람에게 필요한 것은 「지금 소개받을 수 있는가」 하나다. 소개가 어디까지
-- 왔는지는 사람이 아니라 **두 사람 사이의 관계**가 가진 상태이고, 그것은 이미
-- `match_requests`(프로필 × 프로필) 한 행이 들고 있다. 한 사람이 여러 명과 동시에
-- 신청을 주고받을 수 있으므로 「매칭 진행」 같은 값을 프로필에 두면 어느 관계의 것인지
-- 말할 수 없다.
--
-- 그래서 `profile_status` 를 ('ACTIVE','INACTIVE') 로 다시 만들고, 상태와 따로 놀던
-- 노출 축(`visibility`: 리스트 노출 · 링크 전용 · 비공개)을 없앤다. 활성이면 같은 쪽
-- 멤버의 목록과 상세에 보이고, 비활성이면 멤버에게 전혀 보이지 않는다.
--
-- 옮기는 규칙: 멤버 목록에 보이던 것(ACTIVE·MATCHING 이면서 LISTED)만 활성이다.
-- 링크 전용(UNLISTED)은 목록에 없던 사람이므로 비활성으로 보낸다 — 더 드러나는
-- 쪽으로 옮기지 않는다.

-- ── 옛 값을 참조하는 것부터 걷어낸다 ─────────────────────────────
-- 정책과 부분 인덱스가 컬럼을 물고 있으면 타입을 바꿀 수 없다.
DROP POLICY profiles_read ON profiles;
DROP INDEX profiles_discover_idx;
DROP INDEX profiles_filter_idx;
DROP INDEX profiles_status_idx;
DROP INDEX profiles_group_idx;
DROP INDEX profiles_public_idx;

-- ── 상태 두 값 ───────────────────────────────────────────────
CREATE TYPE profile_status_v2 AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE profiles ALTER COLUMN status DROP DEFAULT;
ALTER TABLE profiles
  ALTER COLUMN status TYPE profile_status_v2
  USING (
    CASE
      WHEN status IN ('ACTIVE', 'MATCHING') AND visibility = 'LISTED'
        THEN 'ACTIVE'
      ELSE 'INACTIVE'
    END
  )::profile_status_v2;

ALTER TABLE profiles DROP COLUMN visibility;
DROP TYPE profile_visibility;
DROP TYPE profile_status;
ALTER TYPE profile_status_v2 RENAME TO profile_status;

-- 새 프로필은 주선자가 켜기 전까지 멤버에게 보이지 않는다.
ALTER TABLE profiles ALTER COLUMN status SET DEFAULT 'INACTIVE';

-- ── 인덱스 ───────────────────────────────────────────────────
CREATE INDEX profiles_discover_idx ON profiles (created_at DESC, id DESC)
  WHERE status = 'ACTIVE';
CREATE INDEX profiles_filter_idx ON profiles (gender, birth_year, residence_region)
  WHERE status = 'ACTIVE';
CREATE INDEX profiles_status_idx ON profiles (status, created_at DESC);
CREATE INDEX profiles_group_idx ON profiles (group_id, status);
CREATE INDEX profiles_public_idx ON profiles (status) WHERE group_id IS NULL;

-- ── 열람 ─────────────────────────────────────────────────────
-- 0048 의 정책에서 상태·노출 두 조건을 `status = 'ACTIVE'` 하나로 바꾼다.
-- 나머지 절(주선자 열람 · 자기 프로필 · 같은 풀의 이성)은 그대로다.
CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (
    app_can_view_profile_as_admin(group_id)
    OR user_id = app_current_user_id()
    OR (
      app_current_profile_id() IS NOT NULL
      AND group_id IS NOT DISTINCT FROM app_current_member_group()
      AND status = 'ACTIVE'
      AND gender <> app_current_member_gender()
    )
  );
