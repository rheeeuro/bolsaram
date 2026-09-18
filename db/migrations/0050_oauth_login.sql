-- 0050: 주선자 인증을 소셜 로그인(카카오·구글)으로 옮긴다
--
-- 비밀번호를 우리가 보관하지 않는다. 주선자 계정 하나로 모임 전체 회원의 이름·연락처에
-- 닿을 수 있어서, 이 저장소가 지킬 수 있는 것보다 강한 보호가 필요했다 — 2단계 인증과
-- 비밀번호 재설정을 직접 만드는 대신 카카오·구글에 맡긴다.
--
-- 신원은 `oauth_accounts` 가 가진다. `users.email` 은 같은 사람이 두 제공자로 들어왔을 때
-- 하나의 계정으로 이어붙이는 힌트일 뿐이고, 카카오는 이메일 동의를 받지 못할 수 있어서
-- 비어 있을 수 있다.

CREATE TYPE oauth_provider AS ENUM ('KAKAO', 'GOOGLE');

CREATE TABLE oauth_accounts (
  provider      oauth_provider NOT NULL,
  -- 제공자가 주는 고유 식별자. 카카오는 숫자 id, 구글은 sub 다. 이메일과 달리 바뀌지 않는다.
  subject       text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 마지막 로그인에서 받은 이메일. 계정을 찾는 데는 쓰지 않는다(찾는 기준은 subject 다).
  email         citext,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX oauth_accounts_user_idx ON oauth_accounts (user_id);

-- 인증 전용 테이블이다. sessions 와 같은 취급으로 정책을 만들지 않고 런타임 롤의 권한을
-- 회수한다(0001 의 ALTER DEFAULT PRIVILEGES 가 자동으로 주기 때문에 명시적으로 되돌린다).
ALTER TABLE oauth_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_accounts FROM bolsaram_app;

-- 주선자에게 비밀번호를 요구하던 제약을 푼다. 신원은 이제 oauth_accounts 가 가지므로
-- 한 테이블의 CHECK 로는 표현할 수 없고, 계정 생성 경로(server/auth/oauth.ts)가 지킨다.
ALTER TABLE users DROP CONSTRAINT users_admin_needs_credentials;
ALTER TABLE users DROP COLUMN password_hash;

-- 비밀번호 시도 제한이 필요 없어졌다 — 자격 증명을 우리가 받지 않는다.
DROP TABLE admin_login_failures;
