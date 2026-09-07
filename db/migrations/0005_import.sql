-- 0005: Import 파이프라인 (설계문서 §9, 모바일 가이드)

CREATE TABLE import_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source        import_source NOT NULL DEFAULT 'MANUAL_UPLOAD',
  status        import_status NOT NULL DEFAULT 'RECEIVED',
  -- 카카오톡에서 넘어온 원문. 정규화본이 아니라 원본 그대로 보관한다.
  raw_text      text,
  error_message text,
  -- commit 결과. 재호출 시 이 값이 있으면 같은 프로필을 돌려준다(idempotency).
  committed_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  idempotency_key text,
  committed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT import_sessions_commit_pair CHECK (
    (committed_at IS NULL AND committed_profile_id IS NULL)
    OR (committed_at IS NOT NULL AND committed_profile_id IS NOT NULL)
  )
);
CREATE TRIGGER import_sessions_set_updated_at BEFORE UPDATE ON import_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX import_sessions_inbox_idx ON import_sessions (status, created_at DESC);
CREATE INDEX import_sessions_creator_idx ON import_sessions (created_by, created_at DESC);
-- 같은 idempotency key 로는 한 번만 commit 된다.
CREATE UNIQUE INDEX import_sessions_idempotency
  ON import_sessions (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE import_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  type              import_asset_type NOT NULL DEFAULT 'IMAGE',
  storage_key       text NOT NULL,
  original_filename text,
  mime_type         text NOT NULL,
  byte_size         integer NOT NULL CHECK (byte_size > 0),
  sort_order        smallint NOT NULL DEFAULT 0,
  -- 업로드가 끝나야 분석 대상이 된다. 재시도 시 같은 행을 다시 쓴다.
  uploaded_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (import_session_id, sort_order)
);
CREATE INDEX import_assets_session_idx ON import_assets (import_session_id, sort_order);

CREATE TABLE import_extractions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  -- extractedFieldsSchema 로 validate 된 결과만 들어간다.
  fields_json       jsonb NOT NULL,
  confidence_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes             text[] NOT NULL DEFAULT '{}',
  -- 모델 원문. 디버깅용이며 검토가 끝나면 정리 정책에 따라 지운다.
  raw_model_output  jsonb,
  model             text NOT NULL,
  prompt_version    text NOT NULL,
  -- 사람이 수정한 값. NULL 이면 아직 AI 결과 그대로다.
  reviewed_fields_json jsonb,
  reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_extractions_session_idx
  ON import_extractions (import_session_id, created_at DESC);

-- 세션당 최신 추출 하나를 빠르게 찾기 위한 뷰.
CREATE VIEW import_latest_extractions AS
SELECT DISTINCT ON (import_session_id) *
FROM import_extractions
ORDER BY import_session_id, created_at DESC;
