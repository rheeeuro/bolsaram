-- 0016: invites_claim_pair 제약 완화
--
-- `claimed_by` 는 `ON DELETE SET NULL` 인데 제약이 `claimed_at` 과 짝을 요구했다.
--
--   CHECK ((claimed_at IS NULL AND claimed_by IS NULL)
--          OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL))
--
-- 그래서 **링크를 쓴 회원을 삭제할 수 없었다** — FK 가 claimed_by 를 NULL 로 바꾸려
-- 하면 이 제약에 걸려 DELETE 가 실패한다. 회원 탈퇴 처리가 막히는 셈이다.
-- 매직 링크로 회원 계정이 만들어지기 시작한 뒤로는 더 자주 부딪힌다.
--
-- 원래 의도는 「replay 금지: claim 되면 누가 썼는지 남는다」였다. 하지만 replay 를
-- 실제로 막는 것은 `claimed_at IS NOT NULL` 이고, `claimed_by` 는 계정이 사라지면
-- 잃을 수 있는 감사 정보다. 그래서 방향을 하나만 남긴다 —
-- **쓴 사람은 있는데 쓴 시각이 없는 상태만 막는다.**

ALTER TABLE invites DROP CONSTRAINT invites_claim_pair;
ALTER TABLE invites ADD CONSTRAINT invites_claim_pair CHECK (
  claimed_by IS NULL OR claimed_at IS NOT NULL
);
