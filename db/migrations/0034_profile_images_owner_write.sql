-- 0034: 사진을 고치는 것도 등록한 주선자만
--
-- profile_images 쓰기 정책이 `app_is_admin()` 하나였다. 주선자 가입이 열려 있으므로
-- **아무나 가입해서 남의 회원 사진을 바꾸거나 지울 수 있는 상태**였다. 사진을 고치는
-- API 가 없어서 드러나지 않았을 뿐이고, 지금 그 API 를 붙이면 실제로 열린다.
--
-- 저장소 규칙은 이미 이렇게 정해져 있다 — 「ADMIN 이라는 사실만으로 권한을 주지
-- 않는다. 읽기와 쓰기를 다르게 준다.」 프로필 본문(0011)과 같은 술어를 쓴다.

DROP POLICY profile_images_admin_write ON profile_images;

-- 자기 모임 것이거나, 전체공개인데 자기가 등록한 것이면 고친다.
CREATE POLICY profile_images_owner_write ON profile_images FOR ALL
  USING (app_can_edit_profile(profile_id))
  WITH CHECK (app_can_edit_profile(profile_id));
