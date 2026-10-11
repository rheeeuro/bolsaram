-- 0061: 등록한 주선자가 그 프로필에 연결된 **멤버 계정**을 지운다
--
-- 처리방침은 「내리고 싶다」고 하면 프로필·사진·계정을 곧바로 지운다고 약속한다.
-- 프로필 삭제는 `profiles_admin_delete`(등록한 주선자만)가 이미 열려 있지만
-- `users` 에는 DELETE 정책이 없어 런타임 롤로는 계정을 지울 수 없었다.
--
-- 범위는 열람 정책(`users_self_select`)의 담당 분기와 같다 — 내가 고칠 수 있는
-- 프로필에 연결된 계정만. 그리고 **멤버만** 지운다. 주선자 계정은 사람이 쓰는
-- 로그인이라 프로필 삭제가 건드리지 않는다.
--
-- 프로필보다 **먼저** 지워야 한다. 프로필이 사라지면 이 판정이 근거를 잃는다.

CREATE POLICY users_admin_delete_member ON users FOR DELETE
  USING (
    role = 'MEMBER'
    AND EXISTS (
      SELECT 1 FROM profiles p
       WHERE p.user_id = users.id
         AND app_can_edit_profile(p.id)
    )
  );
