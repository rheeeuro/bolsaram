-- 0009: 관리자 로그인 시도 제한
--
-- 회원 OTP 에는 시도 제한(login_codes.attempts)이 있었지만 관리자 비밀번호에는
-- 아무 제한이 없었다. 공개 도메인에서 무한히 시도할 수 있었다.
--
-- 실패를 행으로 남기고 "최근 창 안의 실패 횟수"로 판정한다. 카운터 하나를 두는 대신
-- 행으로 남기는 이유는 두 가지다 — 창이 지나면 자연히 풀려서 영구 락아웃이 없고,
-- 주선자가 공격 흔적을 볼 수 있다.
--
-- 인증 전용 테이블이다. sessions/login_codes 와 같은 취급으로 정책을 만들지 않고
-- 런타임 롤의 권한을 회수한다(0001 의 ALTER DEFAULT PRIVILEGES 가 자동으로 주므로
-- 시퀀스까지 명시적으로 되돌려야 한다).

CREATE TABLE admin_login_failures (
  id        bigserial PRIMARY KEY,
  -- 존재하지 않는 이메일로 온 시도도 남긴다. 계정 존재 여부를 응답으로 구분할 수
  -- 없게 하려면 판정도 이메일 문자열 기준이어야 한다.
  email     citext NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_login_failures_email_idx
  ON admin_login_failures (email, failed_at DESC);

ALTER TABLE admin_login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_login_failures FROM bolsaram_app;
REVOKE ALL ON SEQUENCE admin_login_failures_id_seq FROM bolsaram_app;
