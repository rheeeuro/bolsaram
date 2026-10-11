-- 0060: 주선자 코멘트
--
-- 주선자가 맡은 분을 소개하는 한마디. 본인이 쓴 자기소개와 달리 **주선자의 말**이고,
-- 멤버 상세 화면에 「주선자 코멘트」로 보인다(공개 단계 DETAIL — 소개·이상형과 같다).
--
-- 0059 의 메모와 다르다 — 메모는 담당만 읽으므로 테이블을 갈랐지만, 코멘트는 프로필을
-- 볼 수 있는 사람이면 누구나 읽는 내용이라 `profiles` 컬럼으로 둔다. 쓰기는 기존
-- `profiles_admin_update`(app_can_edit_profile) 그대로 등록한 주선자만 한다.
-- 테이블 단위 GRANT 라 런타임 롤 권한은 따로 줄 것이 없다.

ALTER TABLE profiles ADD COLUMN host_comment text;

ALTER TABLE profiles ADD CONSTRAINT profiles_host_comment_len
  CHECK (host_comment IS NULL OR length(host_comment) BETWEEN 1 AND 500);
