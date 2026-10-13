-- 0066: 모임 초대 코드 여러 번 쓰기
--
-- 모임 초대 코드는 1회용이다. 여러 동료를 한꺼번에 들일 때마다 코드를 새로 받아
-- 한 명씩 보내야 해서, 관리자가 「24시간 동안 같은 코드로 여러 명이 합류」를 켤 수
-- 있게 한다.
--
-- operator_settings.group_invite_reusable
--   켜져 있을 때 발급한 코드는 만료 전까지 여러 번 쓸 수 있다. 기본은 1회용.
--
-- group_invite_codes.reusable
--   발급할 때의 설정을 코드에 남긴다 — 발급 화면이 「1회용」인지 「여러 번」인지를
--   그 자리에서 말해 주려면 코드가 자기 성격을 알아야 한다. 켜는 쪽은 소급하지
--   않는다(이미 나간 1회용 코드는 1회용으로 남는다). 끄는 쪽은 소비 조건이 지금
--   설정도 함께 보므로 **바로 1회용으로 돌아간다** — 이미 한 번 쓰인 코드는 그때부터
--   막힌다.
--
-- group_invite_codes.use_count
--   몇 번 쓰였는지. `consumed_at`·`consumed_by` 는 마지막으로 쓴 시각·사람이다.
--   `consumed_at IS NOT NULL` 이 「한 번 이상 쓰였다」라는 뜻은 그대로다.
--
-- 두 테이블 모두 owner 전용이다(0012·0064). 정책·권한을 바꾸지 않는다.

ALTER TABLE operator_settings
  ADD COLUMN group_invite_reusable boolean NOT NULL DEFAULT false;

ALTER TABLE group_invite_codes
  ADD COLUMN reusable  boolean NOT NULL DEFAULT false,
  ADD COLUMN use_count integer NOT NULL DEFAULT 0
    CONSTRAINT group_invite_codes_use_count_nonneg CHECK (use_count >= 0);

UPDATE group_invite_codes SET use_count = 1 WHERE consumed_at IS NOT NULL;
