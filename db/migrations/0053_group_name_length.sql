-- 0053: 모임 이름 길이를 20자로 좁힌다
--
-- 모임 이름은 목록·전환기·채팅 헤더처럼 좁고 줄바꿈 없는 자리에 들어간다. 80자까지
-- 받으면 그 자리에서 잘려 어느 모임인지 알아볼 수 없으므로, 잘리는 대신 처음부터
-- 짧게 받는다. 애플리케이션은 `groupNameSchema` 가 같은 값을 쓴다.
--
-- 표시 이름(`users.display_name`)에는 대응하는 CHECK 를 두지 않는다 — 소셜 제공자가
-- 준 이름과 멤버 실명이 같은 컬럼에 들어가고, 그 값은 본인이 입력한 것이 아니다.
-- 본인이 고치는 경로(`/api/admin/me`)만 스키마로 막는다.

ALTER TABLE groups DROP CONSTRAINT groups_name_check;
ALTER TABLE groups ADD CONSTRAINT groups_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 20);
