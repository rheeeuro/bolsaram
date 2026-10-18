-- 0069: 이상형 조건 — 이상형 글을 AI 가 읽어 만든 구조화된 조건 (추천용 파생 캐시)
--
-- 주선자 화면의 「이상형에 맞는 분」은 이 분의 이상형 조건을 같은 쪽 이성의 프로필
-- 항목과 견주고, 거꾸로 상대의 이상형 조건에 이 분이 맞는지도 본다. 견주는 것은
-- 규칙(packages/domain 의 recommend)이고, AI 는 글을 조건으로 바꾸는 데만 쓴다.
--
-- 조건은 원문(`profiles.ideal_type_text`)에서 언제든 다시 만들 수 있는 **파생 값**이라
-- 별도 테이블에 캐시한다. `source_hash` 는 조건을 만든 입력(프롬프트 판·성별·출생연도·
-- 이상형 글)의 해시다 — 읽는 쪽이 지금 프로필로 같은 해시를 계산해 다르면 버리고 다시
-- 만든다. 그래서 이상형 글을 고칠 때 이 테이블을 함께 지울 필요가 없다.
--
-- 읽기·쓰기 모두 **그 프로필을 볼 수 있는 주선자**에게 연다. 추천은 상대 쪽 조건도
-- 읽어야 하고(역방향), 아직 조건이 없으면 보는 사람이 만들어 채운다. 원문을 고칠 수
-- 있는 사람은 여전히 등록한 주선자뿐이고, 이 칸은 앱이 AI 출력을 검증해 넣는 값이다.
-- 멤버 정책은 주지 않는다 — 추천은 주선자 화면에만 있다.

CREATE TABLE profile_ideal_criteria (
  profile_id      uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  source_hash     text NOT NULL,
  criteria        jsonb NOT NULL,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_ideal_criteria_shape CHECK (jsonb_typeof(criteria) = 'object'),
  CONSTRAINT profile_ideal_criteria_hash_len CHECK (length(source_hash) = 64)
);

CREATE TRIGGER profile_ideal_criteria_set_updated_at BEFORE UPDATE ON profile_ideal_criteria
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE profile_ideal_criteria ENABLE ROW LEVEL SECURITY;

-- 프로필 행을 볼 수 있는 주선자 = 이 조건을 볼 수 있는 주선자.
-- `profiles` 를 직접 묻지 않고 그 모임 판정을 쓴다 — `profiles_read` 에는 멤버 절이
-- 섞여 있어서, 대행 중인 세션이 이 칸을 통과하지 않게 주선자 판정만 남긴다.
CREATE POLICY profile_ideal_criteria_admin ON profile_ideal_criteria FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = profile_ideal_criteria.profile_id
       AND app_can_view_profile_as_admin(p.group_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = profile_ideal_criteria.profile_id
       AND app_can_view_profile_as_admin(p.group_id)
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON profile_ideal_criteria TO bolsaram_app;
