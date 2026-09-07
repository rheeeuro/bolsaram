-- 0003: 핵심 테이블 (설계문서 §9)

-- ── User ──────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          user_role NOT NULL DEFAULT 'MEMBER',
  phone         text UNIQUE,
  email         citext UNIQUE,
  -- 관리자만 비밀번호를 쓴다. 회원은 전화번호 OTP 로 로그인한다.
  password_hash text,
  display_name  text,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- 관리자는 이메일+비밀번호, 회원은 전화번호가 반드시 있어야 한다.
  CONSTRAINT users_admin_needs_credentials CHECK (
    role <> 'ADMIN' OR (email IS NOT NULL AND password_hash IS NOT NULL)
  ),
  CONSTRAINT users_member_needs_phone CHECK (
    role <> 'MEMBER' OR phone IS NOT NULL
  )
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Profile ───────────────────────────────────────────────────
-- public_code 는 사용자에게 `#17` 로 보이는 익명 코드. 순번을 재사용하지 않는다.
CREATE SEQUENCE profile_public_code_seq START 11;

CREATE TABLE profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Claim 전에는 NULL. 한 사용자는 프로필 하나만 가진다.
  user_id          uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  public_code      integer NOT NULL UNIQUE DEFAULT nextval('profile_public_code_seq'),

  gender           gender NOT NULL,
  birth_year       smallint NOT NULL CHECK (birth_year BETWEEN 1960 AND 2010),
  height           smallint CHECK (height BETWEEN 130 AND 220),
  job_title        text,
  job_category     job_category,
  company          text,
  education        text,
  residence_region region NOT NULL,
  workplace_region region,
  religion         religion,
  mbti             char(4) CHECK (mbti ~ '^[EI][NS][FT][JP]$'),
  smoking          smoking_level,
  drinking         drinking_level,
  hobbies          text[] NOT NULL DEFAULT '{}',
  bio              text,
  ideal_type_text  text,

  -- INTRODUCED 이후에만 공개되는 식별 정보(설계문서 §5).
  real_name        text,
  contact_note     text,

  status           profile_status NOT NULL DEFAULT 'INACTIVE',
  visibility       profile_visibility NOT NULL DEFAULT 'PRIVATE',

  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profiles_hobbies_len CHECK (cardinality(hobbies) <= 12)
);
ALTER SEQUENCE profile_public_code_seq OWNED BY profiles.public_code;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Discover 기본 정렬 + 필터. 부분 인덱스로 공개 프로필만 담는다.
CREATE INDEX profiles_discover_idx
  ON profiles (created_at DESC, id DESC)
  WHERE status IN ('ACTIVE','MATCHING') AND visibility = 'LISTED';
CREATE INDEX profiles_filter_idx
  ON profiles (gender, birth_year, residence_region)
  WHERE status IN ('ACTIVE','MATCHING') AND visibility = 'LISTED';
CREATE INDEX profiles_status_idx ON profiles (status, created_at DESC);
CREATE INDEX profiles_hobbies_gin ON profiles USING gin (hobbies);

-- ── ProfileImage ──────────────────────────────────────────────
CREATE TABLE profile_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- private 스토리지 내부 키. 영구 공개 URL 은 저장하지 않는다(설계문서 §12).
  storage_key text NOT NULL,
  mime_type   text NOT NULL,
  byte_size   integer NOT NULL CHECK (byte_size > 0),
  width       integer,
  height      integer,
  sort_order  smallint NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (profile_id, sort_order)
);
-- 대표 사진은 프로필당 최대 하나.
CREATE UNIQUE INDEX profile_images_one_primary
  ON profile_images (profile_id) WHERE is_primary;
CREATE INDEX profile_images_profile_idx ON profile_images (profile_id, sort_order);
