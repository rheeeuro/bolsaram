-- 0047: 프로필 해시태그
--
-- 취미·직업군만으로는 「어떤 사람인지」가 목록에서 드러나지 않는다. Import 때 AI 가
-- 원문에서 짧은 태그를 뽑아 두고, 회원이 그 태그로 탐색한다.
--
-- ── 왜 별도 컬럼인가 ─────────────────────────────────────────
-- `hobbies` 와 섞지 않는다. 취미는 사람이 적은 그대로의 문장(「주말엔 등산」)이고,
-- 해시태그는 검색 키라서 정규화된 형태(`#` 없이, 공백 없이, 소문자)만 들어온다.
-- 정규화는 애플리케이션(`packages/schemas/src/hashtag.ts`)이 하고, DB 는 개수와
-- 모양만 지킨다.
--
-- ── 정책은 손대지 않는다 ─────────────────────────────────────
-- profiles 의 RLS 정책은 행 단위라 컬럼이 늘어도 그대로 적용된다. 태그는 프로필
-- 상세와 같은 공개 단계(DETAIL)에 속하며, 그 판정은 애플리케이션 레이어가 한다.

ALTER TABLE profiles
  ADD COLUMN hashtags text[] NOT NULL DEFAULT '{}';

-- 개수 상한은 schemas 의 HASHTAG_MAX_COUNT 와 같다.
ALTER TABLE profiles
  ADD CONSTRAINT profiles_hashtags_len CHECK (cardinality(hashtags) <= 10);

-- 정규화된 형태만 들어오게 막는다. `#`·공백·빈 문자열이 섞이면 같은 태그가 둘로 갈린다.
-- CHECK 는 서브쿼리를 못 쓰므로 판정을 immutable 함수로 뺀다.
CREATE FUNCTION app_hashtags_valid(tags text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    bool_and(tag <> '' AND tag !~ '[#[:space:]]' AND char_length(tag) <= 20),
    true
  )
  FROM unnest(tags) AS tag;
$$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_hashtags_shape CHECK (app_hashtags_valid(hashtags));

-- 태그 검색(`hashtags @> ARRAY[...]`)이 순차 스캔으로 떨어지지 않게 한다.
CREATE INDEX profiles_hashtags_gin ON profiles USING gin (hashtags);
