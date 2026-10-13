-- 모임 채팅 텔레그램 알림을 세 단계로 고른다.
--
--   ALL       이 방의 새 글마다(쓴 사람 제외)
--   MENTIONS  본문에 나를 부른 멘션(`@내 이름`)이 있을 때만 — 기본값
--   OFF       보내지 않는다
--
-- 기본값이 「멘션만」인 이유: 나를 부른 글은 놓치면 안 되고, 그 밖의 글까지 울리면
-- 방이 활발할수록 알림을 끄게 된다. 설정 행이 아직 없는 사람(방을 열어 본 적도, 설정을
-- 만진 적도 없는 사람)도 같은 기본값으로 본다.
--
-- 기존 값은 켜 둔 사람만 「모든 새 메시지」로 옮기고, 나머지는 기본값(멘션만)이 된다.
-- 꺼 둔 것과 손대지 않은 것을 구분할 수 없었기 때문이다.
--
-- 알림 행은 **텔레그램을 연결한 사람에게만** 만든다. 보낼 곳이 없는 알림을 쌓아 두면
-- 나중에 연결하는 순간 지난 알림이 한꺼번에 나간다.

CREATE TYPE group_chat_notify AS ENUM ('ALL', 'MENTIONS', 'OFF');

ALTER TABLE group_chat_prefs
  ADD COLUMN notify group_chat_notify NOT NULL DEFAULT 'MENTIONS';

UPDATE group_chat_prefs SET notify = 'ALL' WHERE telegram_notify;

ALTER TABLE group_chat_prefs DROP COLUMN telegram_notify;

COMMENT ON COLUMN group_chat_prefs.notify IS
  '이 방의 텔레그램 알림 — ALL 새 글마다 · MENTIONS 나를 부른 글만(기본) · OFF 끔';

/**
 * 사람의 새 글을 이 방 주선자에게 알린다(아웃박스).
 *
 * 멘션 판정은 화면과 같다 — 본문에 `@` 와 그 주선자의 표시 이름이 이어 나오면 부른
 * 것이다(`server/repo/group-chat.ts` 의 HOST_LINKS). 이름 뒤에 「님」이 붙어도 된다.
 *
 * payload 에는 모임 이름과 「나를 불렀는가」만 싣는다. 본문은 싣지 않는다.
 * 아직 보내지 않은 알림이 있으면 접힌다(ON CONFLICT) — 먼저 쌓인 것이 남는다.
 */
CREATE OR REPLACE FUNCTION app_enqueue_group_message_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.system_kind IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (kind, recipient_user_id, group_id, payload)
  SELECT
    'GROUP_MESSAGE',
    target.user_id,
    NEW.group_id,
    jsonb_build_object(
      'groupName', (SELECT g.name FROM groups g WHERE g.id = NEW.group_id),
      'mention', target.mentioned
    )
  FROM (
    SELECT ga.user_id,
           COALESCE(pref.notify, 'MENTIONS') AS notify,
           (COALESCE(u.display_name, '') <> ''
             AND strpos(NEW.body, '@' || u.display_name) > 0) AS mentioned
      FROM group_admins ga
      JOIN users u ON u.id = ga.user_id
      LEFT JOIN group_chat_prefs pref
        ON pref.group_id = ga.group_id AND pref.user_id = ga.user_id
     WHERE ga.group_id = NEW.group_id
       AND ga.user_id IS DISTINCT FROM NEW.author_user_id
       AND EXISTS (SELECT 1 FROM telegram_connections tc WHERE tc.user_id = ga.user_id)
  ) target
  WHERE target.notify = 'ALL'
     OR (target.notify = 'MENTIONS' AND target.mentioned)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
