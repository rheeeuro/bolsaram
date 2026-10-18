-- 0071: 가져오기 원문 비교 키 — 같은 원문이 두 번 들어온 것을 「중복」으로 표시한다
--
-- 카카오톡방에 쌓인 프로필을 옮기다 보면 같은 글을 웹과 봇으로, 또는 두 번 올리게 된다.
-- 검토 화면과 가져오기 목록이 같은 원문을 가진 다른 가져오기를 알려주도록 비교 키를 둔다.
--
-- 키는 **보이는 글자만** 비교한다 — 공백·줄바꿈·제로폭 문자와 카카오톡이 복사할 때 붙이는
-- `[이름] [오후 3:12]` 말머리를 뺀 원문의 md5. 같은 글을 다른 시각에 복사해도 같은 키가
-- 나온다. 20자 미만이면 NULL — 「사진입니다」 같은 짧은 글끼리 중복으로 묶이지 않게 한다.
--
-- 생성 칼럼이라 기존 행도 채워지고, 검토 화면에서 원문을 고치면 키도 함께 바뀐다.
-- 열람 범위는 `import_sessions` 행과 같다(RLS) — 중복은 내가 볼 수 있는 가져오기
-- 사이에서만 드러난다. 남의 원문이 있는지 알려주는 우회 경로를 만들지 않는다.

CREATE FUNCTION import_raw_text_key(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN char_length(k) >= 20 THEN md5(k) END
    FROM (
      SELECT regexp_replace(
               regexp_replace(raw, '^\[[^]]{1,30}\]\s*\[[^]]{1,20}\]', '', 'gn'),
               '[\s​-‍﻿]+', '', 'g') AS k
    ) normalized
$$;

ALTER TABLE import_sessions
  ADD COLUMN raw_text_key text GENERATED ALWAYS AS (import_raw_text_key(raw_text)) STORED;

CREATE INDEX import_sessions_raw_text_key_idx
  ON import_sessions (raw_text_key) WHERE raw_text_key IS NOT NULL;
