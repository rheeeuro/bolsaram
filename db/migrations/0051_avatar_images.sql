-- 0051: 주선자 프로필 사진과 모임 사진
--
-- 지금까지 사람과 모임은 이름의 앞글자로만 구분됐다. 한 주선자가 여러 모임을 오가고
-- 모임 채팅에서 동료를 알아봐야 하는데, 앞글자만으로는 「ㅅ」이 둘이면 구분이 되지 않는다.
--
-- 사진은 프로필 사진(`profile_images`)과 같은 private 스토리지에 둔다. 컬럼에는 저장 키만
-- 남기고 영구 URL 을 만들지 않는다 — 응답마다 단기 signed URL 을 새로 발급한다.
-- 사진이 없으면 화면은 지금까지대로 앞글자를 그린다. 그래서 둘 다 NULL 을 허용한다.

-- 카카오·구글이 준 프로필 사진으로 시작하고(첫 로그인에서 한 번 받아 둔다) 그 뒤로는
-- 본인이 정한다 — 표시 이름과 같은 규칙이다(`server/auth/oauth.ts`).
ALTER TABLE users ADD COLUMN avatar_key text;

-- 모임 사진은 그 모임의 주선자 누구나 바꾼다. 이름·설명과 같은 취급이다.
ALTER TABLE groups ADD COLUMN image_key text;

-- `users` 는 컬럼 단위로 UPDATE 권한을 준다(0036). 새 컬럼은 명시해야 열린다 —
-- 내 사진을 바꾸는 것은 `users_self_update` 정책 아래 본인 행에서만 일어난다.
GRANT UPDATE (avatar_key) ON users TO bolsaram_app;

-- `groups` 는 테이블 단위 UPDATE 권한이라(0010) 새 컬럼도 함께 열린다.
-- 실제 수정은 인증 레이어(owner 커넥션)의 `updateGroup`·`updateGroupImage` 가 하고,
-- 소속 확인은 `requireGroupAdmin` 이 한다.
