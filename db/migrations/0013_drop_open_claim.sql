-- 0013: profiles_claim 정책 제거
--
-- 이 정책은 **아무 로그인 사용자나** 주인 없는 프로필(`user_id IS NULL`)을 자기 것으로
-- 만들 수 있게 허용했다. 초대 토큰도, 모임 소속도 확인하지 않았다.
--
--   USING (user_id IS NULL AND app_current_user_id() IS NOT NULL)
--   WITH CHECK (user_id = app_current_user_id())
--
-- 그런데 앱의 실제 claim 경로(`server/auth/invite.ts` 의 claimInvite)는 owner
-- 커넥션을 쓰므로 RLS 를 우회한다 — **이 정책은 어느 코드에도 쓰이지 않는다.**
-- 즉 얻는 것 없이 열려 있었다.
--
-- 주선자 가입이 열리고 전체공개 풀이 생긴 뒤에는 위험이 커진다. 누구나 가입해
-- 남의 모임에 있는 주인 없는 프로필을 자기 계정에 붙일 수 있으면, 그 프로필의
-- 회원인 척 그 풀을 들여다볼 수 있다.
--
-- claim 은 해시된 초대 토큰 검증을 통과해야만 일어나야 하고, 그 검증은 평문 토큰이
-- 필요해 RLS 정책으로 표현할 수 없다. 그래서 정책을 없애고 인증 레이어에만 맡긴다.

DROP POLICY profiles_claim ON profiles;
