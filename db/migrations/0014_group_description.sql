-- 0014: 모임 설명
--
-- 모임에 이름 하나만 있어서 초대받은 사람이 맞는 모임인지 판단할 근거가 없었다.
-- 주선자들끼리 보는 메모다 — 회원에게는 노출하지 않는다.

ALTER TABLE groups ADD COLUMN description text
  CHECK (description IS NULL OR length(description) <= 500);
