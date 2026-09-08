-- 0020: 등록 동의 기록 제거 (0019 되돌리기)
--
-- **주선자가 동의를 받고 올린다고 전제한다.** 시스템이 그 사실을 다시 기록하게 만드는
-- 것은 일을 늘리기만 하고, 기록이 있다는 것이 동의를 받았다는 보장도 아니다.
-- 0019 가 만든 컬럼·제약·게이트를 전부 없앤다.
--
-- 한 가지는 남긴다 — **시드 표식**. 0019 의 `SYNTHETIC` 은 동의 기록이 아니라 「이건
-- 합성 데이터다」라는 표식으로도 쓰이고 있었다(`pnpm db:purge-seed` 가 실회원 데이터와
-- 섞인 시드를 이 값으로 가려낸다). 그 용도만 불리언 하나로 옮긴다.

ALTER TABLE profiles ADD COLUMN is_seed boolean NOT NULL DEFAULT false;

-- 표식을 옮긴다. 컬럼을 지우기 전에 해야 한다.
UPDATE profiles SET is_seed = true WHERE consent_method = 'SYNTHETIC';

-- 게시 게이트와 짝 제약. 컬럼을 지우면 함께 사라지지만, 무엇이 없어지는지 드러나도록
-- 명시적으로 지운다.
ALTER TABLE profiles
  DROP CONSTRAINT profiles_listed_requires_consent,
  DROP CONSTRAINT profiles_consent_pair,
  DROP CONSTRAINT profiles_consent_note_len;

DROP INDEX profiles_consent_pending_idx;

ALTER TABLE profiles
  DROP COLUMN consent_method,
  DROP COLUMN consent_at,
  DROP COLUMN consent_note,
  DROP COLUMN consent_recorded_by;

DROP TYPE profile_consent_method;
