-- 0041: 계정이 지워질 때 채팅 메시지의 작성자만 비운다
--
-- 0040 의 가드 트리거는 「지우기 외의 UPDATE」를 전부 막았다. 그런데 작성자 FK 가
-- `ON DELETE SET NULL` 이라 **계정을 지우는 것도 이 메시지의 UPDATE** 다 — 가드가
-- 그것까지 막아서 주선자 계정을 지울 수 없었다(0040 을 붙인 뒤 통합 테스트가 잡았다).
--
-- 계정 삭제 경로만 통과시킨다. 그 UPDATE 는 작성자를 NULL 로 만드는 것 하나뿐이고
-- 본문·모임·시각·지운 표시는 그대로여야 한다 — 그 조건을 다 확인하고 통과시키므로
-- 「고칠 수 없다」는 성질은 그대로다.

CREATE OR REPLACE FUNCTION app_group_message_update_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 계정 삭제(ON DELETE SET NULL). 작성자만 비워지고 나머지는 손대지 않는다.
  IF OLD.author_user_id IS NOT NULL
     AND NEW.author_user_id IS NULL
     AND NEW.group_id = OLD.group_id
     AND NEW.body = OLD.body
     AND NEW.created_at = OLD.created_at
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
  END IF;

  IF NEW.group_id <> OLD.group_id
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '메시지의 모임·작성자·작성 시각은 바꿀 수 없습니다.';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '이미 지운 메시지입니다.';
  END IF;
  IF NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION '메시지는 지우는 것만 할 수 있습니다.';
  END IF;
  NEW.body := '';
  RETURN NEW;
END $$;
