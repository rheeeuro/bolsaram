-- 0054: 프로필 사진을 5장까지만 받는다
--
-- 멤버는 상세에서 사진을 넘겨 보고 주선자는 목록의 원본 보기에서 한 묶음으로 본다.
-- 장수가 늘수록 판단이 쉬워지는 것이 아니라 고르기만 어려워지므로 상한을 둔다.
-- 애플리케이션은 `PROFILE_IMAGE_MAX_COUNT` 가 같은 값을 쓴다.
--
-- 행 여러 개를 세는 규칙이라 CHECK 로는 못 쓰고 트리거로 막는다. 동시 요청이
-- 같은 순간에 들어와도 한쪽만 통과하도록 프로필 단위 advisory lock 을 먼저 잡는다 —
-- 애플리케이션이 미리 세는 것만으로는 경쟁에서 상한을 넘길 수 있다. 프로필 행을
-- 잠그지 않는 이유는 그쪽이 RLS 와 UPDATE 권한을 함께 타기 때문이다.

CREATE FUNCTION app_profile_image_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_count integer;
BEGIN
  -- 같은 프로필에 들어오는 삽입만 직렬화한다. 트랜잭션이 끝나면 자동으로 풀린다.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.profile_id::text, 0));

  SELECT count(*) INTO current_count FROM profile_images WHERE profile_id = NEW.profile_id;
  IF current_count >= 5 THEN
    RAISE EXCEPTION '프로필 사진은 최대 5장입니다'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profile_images_limit BEFORE INSERT ON profile_images
  FOR EACH ROW EXECUTE FUNCTION app_profile_image_limit();
