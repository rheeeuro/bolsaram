-- 0040: 모임 채팅방 (주선자 전용)
--
-- 한 모임에 주선자가 여럿이고(0010) 한 사람이 여러 모임을 오간다(0036). 그런데
-- 주선자끼리 「이 프로필 어때?」를 나눌 곳이 볼사람 안에 없다. 지금은 카카오톡으로
-- 새는데, 그러면 프로필 이야기가 서비스 밖에 쌓이고 나중에 합류한 주선자는 맥락을
-- 잃는다. 모임마다 방을 하나 둔다.
--
-- ── 회원은 들어오지 않는다 ───────────────────────────────────
-- 이 방은 운영 채널이다. 회원을 넣으면 「연결 전 이름 비공개」 경계를 방 안에서
-- 다시 세워야 하고, 회원끼리의 사적 연락 통로가 생긴다. 둘 다 지금 제품이 하지
-- 않기로 한 것이다. 참여자 명단은 따로 만들지 않고 `group_admins` 가 그대로 명단이다 —
-- 모임에 합류하면 방이 열리고 나가면 닫힌다.
--
-- ── 전체공개 채널에는 방이 없다 ──────────────────────────────
-- `group_id IS NULL` 은 모임이 아니라 소속 없음이다. 방의 경계가 모임이므로
-- 전체공개에는 대응하는 방이 없다(FK 가 NOT NULL 이라 만들 수도 없다).

CREATE TABLE group_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- 계정이 지워져도 대화의 흐름은 남긴다. 그때는 작성자 없는 메시지로 보인다.
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- 지운 메시지. 행은 남기고 본문을 비운다(아래 가드 트리거가 비운다).
  deleted_at     timestamptz,

  CONSTRAINT group_messages_body_sane CHECK (
    length(body) <= 2000
    AND (deleted_at IS NOT NULL OR length(btrim(body)) >= 1)
  )
);

-- 방을 열면 최근 것부터 읽는다.
CREATE INDEX group_messages_group_idx ON group_messages (group_id, created_at DESC);

/**
 * 주선자 한 사람의 방 상태 — 어디까지 읽었는가, 텔레그램으로도 받을 것인가.
 *
 * 참여 자체는 `group_admins` 가 정하므로 이 행이 없어도 방은 보인다. 행은 처음
 * 읽음을 찍거나 알림을 켤 때 생긴다(없으면 「전부 안 읽음, 알림 꺼짐」).
 */
CREATE TABLE group_chat_prefs (
  group_id        uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  -- 기본은 꺼짐. 화면 배지로 충분하고, 켜는 것은 모임 설정에서 사람이 고른다.
  telegram_notify boolean NOT NULL DEFAULT false,

  PRIMARY KEY (group_id, user_id)
);

-- ── 고치지 못하게 한다 ───────────────────────────────────────
--
-- UPDATE 정책을 주는 이유는 **지우기** 하나다. 본문을 나중에 바꿀 수 있으면 방에
-- 남은 기록이 근거가 되지 못한다. 애플리케이션에서도 지우기만 부르지만 DB 가 막는다.
CREATE OR REPLACE FUNCTION app_group_message_update_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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
  -- 지운 메시지의 본문은 DB 에도 남기지 않는다.
  NEW.body := '';
  RETURN NEW;
END $$;

CREATE TRIGGER group_messages_update_guard
  BEFORE UPDATE ON group_messages
  FOR EACH ROW EXECUTE FUNCTION app_group_message_update_guard();

-- ── RLS ──────────────────────────────────────────────────────
-- 판정은 `app_is_group_admin()` 하나다 — 속한 모임의 방만 읽고 쓴다.
-- 지금 보고 있는 채널(`users.active_group_id`)은 보지 않는다. 그것은 화면 필터다.

ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_messages_read ON group_messages FOR SELECT
  USING (app_is_group_admin(group_id));

-- 남의 이름으로 쓰지 못한다. 작성자는 반드시 자기 자신이다.
CREATE POLICY group_messages_write ON group_messages FOR INSERT
  WITH CHECK (app_is_group_admin(group_id) AND author_user_id = app_current_user_id());

-- 자기 메시지만. 위 가드 트리거가 「지우기」로 좁힌다.
CREATE POLICY group_messages_own_delete ON group_messages FOR UPDATE
  USING (app_is_group_admin(group_id) AND author_user_id = app_current_user_id())
  WITH CHECK (app_is_group_admin(group_id) AND author_user_id = app_current_user_id());

-- DELETE 정책은 주지 않는다. 대화의 흐름이 끊기지 않게 행은 남긴다.

ALTER TABLE group_chat_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_chat_prefs_own ON group_chat_prefs FOR ALL
  USING (user_id = app_current_user_id() AND app_is_group_admin(group_id))
  WITH CHECK (user_id = app_current_user_id() AND app_is_group_admin(group_id));

GRANT SELECT, INSERT, UPDATE ON group_messages TO bolsaram_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_chat_prefs TO bolsaram_app;

-- ── 알림 (0017 의 아웃박스를 그대로 쓴다) ────────────────────
--
-- 기본은 화면 배지다. 텔레그램은 **각자 켠 사람에게만** 나간다.
--
-- payload 에 싣는 것은 모임 이름뿐이다. 메시지 본문은 넣지 않는다 — 알림은
-- 「방에 새 글이 있다」를 말하고 내용은 볼사람에서 읽는다. 모임 이름은 주선자가
-- 스스로 붙인 이름이라 회원 정보가 아니다.
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'GROUP_MESSAGE';

ALTER TABLE notifications ADD COLUMN group_id uuid REFERENCES groups(id) ON DELETE CASCADE;

COMMENT ON COLUMN notifications.group_id IS
  '모임 채팅 알림이 가리키는 방. 다른 종류의 알림에서는 NULL 이다.';

-- 메시지 한 줄마다 텔레그램이 울리면 알림이 아니라 소음이다. **아직 보내지 않은**
-- 알림이 그 방에 남아 있으면 새로 만들지 않고 접는다(트리거가 ON CONFLICT DO NOTHING).
-- 한 번 나간 뒤에 오는 메시지는 다시 알린다.
--
-- 조건에 kind 를 쓰지 않는 이유: 방금 추가한 enum 값은 같은 트랜잭션 안에서
-- 쓸 수 없다. group_id 는 이 종류의 알림만 채우므로 판정이 같다.
CREATE UNIQUE INDEX notifications_group_pending_idx
  ON notifications (group_id, recipient_user_id)
  WHERE group_id IS NOT NULL AND sent_at IS NULL;

/**
 * 새 메시지 → 알림을 켜 둔 같은 방 주선자들. 쓴 사람은 뺀다.
 *
 * SECURITY DEFINER 인 이유는 0017 과 같다 — 쓰는 사람의 컨텍스트에서는 남의
 * 텔레그램 설정도 `notifications` 도 쓸 수 없다.
 */
CREATE OR REPLACE FUNCTION app_enqueue_group_message_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notifications (kind, recipient_user_id, group_id, payload)
  SELECT
    'GROUP_MESSAGE',
    ga.user_id,
    NEW.group_id,
    jsonb_build_object('groupName', (SELECT g.name FROM groups g WHERE g.id = NEW.group_id))
  FROM group_admins ga
  JOIN group_chat_prefs pref
    ON pref.group_id = ga.group_id AND pref.user_id = ga.user_id
  WHERE ga.group_id = NEW.group_id
    AND ga.user_id IS DISTINCT FROM NEW.author_user_id
    AND pref.telegram_notify
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_enqueue_group_message_notification() FROM PUBLIC;

CREATE TRIGGER group_messages_notify
  AFTER INSERT ON group_messages
  FOR EACH ROW EXECUTE FUNCTION app_enqueue_group_message_notification();
