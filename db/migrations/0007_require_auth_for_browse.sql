-- 0007: 익명 열람 차단
--
-- 0006 의 profiles_read 는 공개 상태 프로필을 익명에게도 허용했다.
-- API 레이어가 인증을 요구하긴 하지만, 설계문서 §12 「권한 없는 사용자가
-- 프로필/이미지를 볼 수 없어야 한다」를 DB 레벨에서도 보장한다.
-- 볼사람은 비공개 서비스이므로 로그인 없이 열람 가능한 프로필은 없다.

DROP POLICY profiles_read ON profiles;

CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (
    app_is_admin()
    OR (
      app_current_user_id() IS NOT NULL
      AND (
        user_id = app_current_user_id()
        OR (status IN ('ACTIVE','MATCHING') AND visibility <> 'PRIVATE')
      )
    )
  );
