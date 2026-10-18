-- 0070: 이상형 조건을 프로필 항목으로 저장한다
--
-- 이상형 조건(나이·키·지역·종교·흡연·음주·직업군 범위, 키워드, 「꼭」 조건)은 가져오기 때
-- AI 추출이 다른 항목과 같은 호출에서 함께 뽑고, 주선자가 검토·편집 화면에서 고친다.
-- 추천은 이 값만 규칙으로 견주므로 추천을 볼 때 AI 를 부르지 않는다.
--
-- 0069 의 `profile_ideal_criteria`(추천을 열 때 AI 로 읽어 채우던 파생 캐시)는 이 칸으로
-- 대체되어 지운다. 그 테이블을 읽는 코드는 남아 있지 않다.
--
-- 모양은 `packages/schemas` 의 `idealCriteriaSchema` 이고, 앱이 쓰기 전에 검증·정리한다.
-- DB 는 객체인지만 본다. 열람 범위는 `profiles` 행과 같다 — 이상형 글(`ideal_type_text`)을
-- 정리한 값일 뿐이라 새로 드러나는 정보가 없고, 멤버 화면에는 내보내지 않는다
-- (`projectProfile` 의 공개 필드에 없다).

ALTER TABLE profiles
  ADD COLUMN ideal_criteria jsonb,
  ADD CONSTRAINT profiles_ideal_criteria_shape
    CHECK (ideal_criteria IS NULL OR jsonb_typeof(ideal_criteria) = 'object');

DROP TABLE profile_ideal_criteria;
