-- 0074: 프로필을 등록한 주선자 — 이름과 사진만
--
-- 주선자 화면의 프로필 상세가 「누가 등록했는지」를 이름·사진과 함께 보여준다. 담당이
-- 등록한 주선자뿐이라(프로필 양도 없음) 누구에게 물어야 하는지가 곧 이 사람이다.
--
-- 그런데 `users` 는 같은 모임 동료와 내가 담당하는 멤버만 보인다(`users_self_select`).
-- 전체공개 프로필은 모르는 주선자가 등록했을 수 있어 런타임 롤로는 그 행을 읽지 못한다.
-- 정책을 넓히면 이메일 같은 신원 칼럼까지 함께 열리므로, **표시 이름과 사진 키만**
-- 돌려주는 함수를 둔다.
--
-- 그 프로필을 주선자로서 볼 수 있을 때만 답한다 — 전체공개거나 내 모임(관리자는 전부)의
-- 것. 볼 수 없는 프로필이나 멤버가 물으면 빈 결과다. 등록한 계정이 지워졌으면 역시 비어 있다.

CREATE FUNCTION app_profile_registrar(target_profile uuid)
  RETURNS TABLE (user_id uuid, display_name text, avatar_key text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.display_name, u.avatar_key
    FROM profiles p
    JOIN users u ON u.id = p.created_by
   WHERE p.id = target_profile
     AND app_can_view_profile_as_admin(p.group_id)
$$;
REVOKE ALL ON FUNCTION app_profile_registrar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_profile_registrar(uuid) TO bolsaram_app;
