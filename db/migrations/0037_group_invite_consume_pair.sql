-- 0037: group_invite_codes_consume_pair 제약 완화
--
-- `invites` 에서 0016 이 고친 것과 같은 문제가 모임 초대 코드에도 있었다.
-- `consumed_by` 는 `ON DELETE SET NULL` 인데 제약이 `consumed_at` 과 짝을 요구했다.
--
--   CHECK ((consumed_at IS NULL AND consumed_by IS NULL)
--          OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL))
--
-- 그래서 **코드를 써서 합류한 주선자를 삭제할 수 없었다** — FK 가 `consumed_by` 를
-- NULL 로 바꾸려 하면 이 제약에 걸려 DELETE 가 실패한다.
--
-- replay 를 실제로 막는 것은 `consumed_at IS NOT NULL` 이고 소비 조건도 그것을 본다.
-- `consumed_by` 는 계정이 사라지면 잃을 수 있는 감사 정보다. 그래서 0016 과 같은
-- 방향으로 한쪽만 남긴다 — **쓴 사람은 있는데 쓴 시각이 없는 상태만 막는다.**

ALTER TABLE group_invite_codes DROP CONSTRAINT group_invite_codes_consume_pair;
ALTER TABLE group_invite_codes ADD CONSTRAINT group_invite_codes_consume_pair CHECK (
  consumed_by IS NULL OR consumed_at IS NOT NULL
);
