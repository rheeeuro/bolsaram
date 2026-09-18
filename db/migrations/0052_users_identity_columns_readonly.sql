-- 0052: 이메일·전화번호를 런타임 롤에서 뺀다
--
-- `users` 는 컬럼 단위로 UPDATE 권한을 준다(0036). 거기에 `email` 과 `phone` 이 들어
-- 있었는데, 둘 다 앱이 쓰지 않는 컬럼이다 — 런타임에서 고치는 것은 표시 이름과
-- 프로필 사진뿐이다(`server/repo/users.ts`).
--
-- 열어 둘 이유가 없는 것보다 더 나쁜 점이 있다. `email` 은 소셜 로그인이 **같은
-- 사람의 계정을 잇는 기준**이다(`server/auth/oauth.ts`). 멤버가 자기 행의 이메일을
-- 주선자의 것으로 바꿔 놓으면, 그 주선자가 다른 제공자로 처음 들어올 때 계정 잇기가
-- 막힌다(멤버 계정에는 붙이지 않고 거절한다). 지금은 이 컬럼을 고치는 경로가 없지만,
-- 권한이 열려 있는 한 새 화면 하나가 그 길을 만든다.
--
-- 신원에 해당하는 값은 인증 레이어(owner 커넥션)만 쓴다 — 모임 소속·활성 채널과 같은
-- 취급이다. `users_self_update` 정책은 그대로 두고 컬럼만 다시 긋는다.

REVOKE UPDATE ON users FROM bolsaram_app;
GRANT UPDATE (display_name, avatar_key, last_login_at, updated_at) ON users TO bolsaram_app;

COMMENT ON COLUMN users.email IS
  '주선자 신원의 힌트. 소셜 로그인이 계정을 잇는 기준이라 런타임 롤은 고치지 못한다(0052).';
