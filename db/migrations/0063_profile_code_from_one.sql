-- 0063: 공개 번호를 1번부터 매긴다.
--
-- 0003 은 시퀀스를 11 에서 시작했다. 이유가 없는 시작값이라 첫 프로필이 「11번」이 된다.
-- 시작값을 1 로 바꾸고, 다음 번호를 「지금 있는 가장 큰 번호 + 1」(없으면 1)로 맞춘다.
-- 이미 있는 번호는 바꾸지 않는다 — 번호는 재사용하지 않으므로 앞으로 발급할 값만 정한다.

ALTER SEQUENCE profile_public_code_seq MINVALUE 1 START WITH 1;

SELECT setval(
  'profile_public_code_seq',
  COALESCE((SELECT max(public_code) FROM profiles), 0) + 1,
  false
);
