-- 0019: 등록되는 사람의 동의 기록
--
-- 프로필은 **주선자가 남을 대신해** 등록한다. 그 시점에 본인은 볼사람을 모를 수 있고,
-- 전체공개로 올리면 가입한 모든 주선자가 본다. 처리방침(`docs/guide/privacy.md`)이
-- 「짚어야 할 것」으로 남겨 둔 항목이며, 지금까지 **어디에도 기록할 자리가 없었다.**
--
-- 동의를 어떻게 받을지는 운영이 정한다. 여기서는 **받았다는 사실을 남길 자리**를 만들고,
-- 기록 없이 게시되지 않도록 DB 가 막는다.
--
-- ── 방법 ──────────────────────────────────────────────────────
--   KAKAO · VERBAL · WRITTEN  실제로 확인한 것. 확인 시각(consent_at)이 함께 있어야 한다.
--   SYNTHETIC                 `pnpm db:seed` 가 만든 합성 데이터. 동의 대상이 아니다.
--   LEGACY                    이 마이그레이션 이전에 등록된 것. **확인이 필요하다.**
--
-- LEGACY 를 두는 이유는 정직함 때문이다. 기존 행에 「동의받았다」를 채워 넣으면 받은 적
-- 없는 동의가 기록으로 남는다. 그렇다고 전부 내리면 돌고 있는 서비스가 멈춘다. 그래서
-- 「확인 안 됨」이라는 상태를 명시하고, 관리자 화면이 그것을 드러내며, 그 프로필의 공개
-- 범위를 다시 손대는 순간 애플리케이션이 실제 방법을 기록하도록 요구한다.

CREATE TYPE profile_consent_method AS ENUM
  ('KAKAO', 'VERBAL', 'WRITTEN', 'SYNTHETIC', 'LEGACY');

ALTER TABLE profiles
  ADD COLUMN consent_method      profile_consent_method,
  -- 실제로 확인한 시각. SYNTHETIC·LEGACY 에는 없다.
  ADD COLUMN consent_at          timestamptz,
  -- 어떻게 확인했는지 한 줄. 개인정보를 옮겨 적는 자리가 아니다.
  ADD COLUMN consent_note        text,
  ADD COLUMN consent_recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT profiles_consent_note_len CHECK (consent_note IS NULL OR length(consent_note) <= 500);

-- ── 기존 행 채우기 ────────────────────────────────────────────
-- Import 로 등록된 것은 실제 사람일 수 있으므로 LEGACY(확인 필요),
-- 그 밖에는 시드가 만든 합성 데이터다.
UPDATE profiles p SET consent_method = 'LEGACY'
 WHERE EXISTS (SELECT 1 FROM import_sessions s WHERE s.committed_profile_id = p.id);
UPDATE profiles SET consent_method = 'SYNTHETIC' WHERE consent_method IS NULL;

-- ── 제약 ──────────────────────────────────────────────────────
-- 방법과 시각의 짝을 맞춘다. 「확인했다는데 언제인지 모르는」 기록을 막는다.
ALTER TABLE profiles ADD CONSTRAINT profiles_consent_pair CHECK (
  consent_method IS NULL
  OR (consent_method IN ('SYNTHETIC', 'LEGACY') AND consent_at IS NULL)
  OR (consent_method IN ('KAKAO', 'VERBAL', 'WRITTEN') AND consent_at IS NOT NULL)
);

-- 게시 게이트. 공개 목록에 올리려면 무엇이든 기록이 있어야 한다.
-- 「실제 동의여야 한다」는 더 강한 요구는 애플리케이션(도메인 레이어)이 건다 —
-- 이미 LISTED 인 LEGACY 프로필을 여기서 끌어내리면 돌고 있는 서비스가 멈춘다.
ALTER TABLE profiles ADD CONSTRAINT profiles_listed_requires_consent CHECK (
  visibility <> 'LISTED' OR consent_method IS NOT NULL
);

-- 확인이 필요한 프로필을 관리자 화면이 자주 센다.
CREATE INDEX profiles_consent_pending_idx ON profiles (group_id)
  WHERE consent_method = 'LEGACY';
