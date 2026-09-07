-- 0001: 확장, 애플리케이션 롤, RLS 컨텍스트 헬퍼
--
-- 권한 모델:
--   bolsaram_owner — 마이그레이션/시드 전용. 테이블 소유자이며 RLS 를 우회한다.
--   bolsaram_app   — 런타임 전용. NOBYPASSRLS 이며 모든 접근이 RLS 정책을 통과해야 한다.
--
-- 요청 컨텍스트는 트랜잭션 로컬 GUC 로 넘긴다(`SET LOCAL app.user_id = ...`).
-- 커넥션 풀에서 값이 새지 않도록 반드시 SET LOCAL 을 쓴다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolsaram_app') THEN
    CREATE ROLE bolsaram_app LOGIN PASSWORD 'bolsaram_app0711' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE bolsaram TO bolsaram_app;
GRANT USAGE ON SCHEMA public TO bolsaram_app;

-- 앞으로 만들 테이블/시퀀스에 대한 기본 권한.
ALTER DEFAULT PRIVILEGES FOR ROLE bolsaram_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bolsaram_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bolsaram_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bolsaram_app;

-- ── 요청 컨텍스트 헬퍼 ────────────────────────────────────────
-- GUC 가 비어 있으면 NULL 을 돌려준다(= 익명). 정책은 NULL 을 항상 거부한다.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_current_role() = 'ADMIN'
$$;

REVOKE ALL ON FUNCTION app_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_current_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO bolsaram_app;
GRANT EXECUTE ON FUNCTION app_current_role() TO bolsaram_app;
GRANT EXECUTE ON FUNCTION app_is_admin() TO bolsaram_app;

-- 모든 테이블이 공유하는 updated_at 트리거.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
