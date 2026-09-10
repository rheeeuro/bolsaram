-- 0035: 본인 계정이 연결된 프로필도 대행할 수 있게 한다
--
-- 0025 는 `user_id IS NULL` 인 프로필만 대행 대상으로 삼았다. 당사자가 자기 초대로
-- 들어오는 순간 대행이 저절로 닫히게 하려는 장치였다. 그런데 실제 운영은 그 반대다 —
-- 계정을 연결한 뒤에도 휴대폰을 잘 쓰지 않아 주선자가 대신 봐야 하는 사람이 있다.
-- 연결 여부는 "본인이 직접 쓰고 있다"는 뜻이 아니라 초대를 한 번 열었다는 뜻일 뿐이다.
--
-- 그래서 연결 여부를 대행 조건에서 뺀다. 남는 경계는 그대로다.
--
--   app_is_admin()            주선자만
--   app_can_edit_profile(id)  자기 모임이거나, 전체공개인데 자기가 등록한 것만
--
-- 대행은 이제 주선자가 끝내거나 세션이 폐기될 때만 닫힌다. 누가 눌렀는지는
-- 감사 로그의 `onBehalf` 와 회원 화면 하단의 대행 띠가 계속 구분해 준다.

CREATE OR REPLACE FUNCTION app_current_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT p.id FROM profiles p
       WHERE p.id = app_acting_profile_id()
         AND app_is_admin()
         AND app_can_edit_profile(p.id)
    ),
    (SELECT id FROM profiles WHERE user_id = app_current_user_id())
  )
$$;
