-- 0044: 모임 채팅방에 시스템 메시지
--
-- 방에 사람 말만 쌓이면 「무슨 일이 있었나」는 여전히 다른 화면을 열어야 안다.
-- 모임에서 일어난 일을 같은 자리에 섞어 두면 대화와 사건이 한 줄기로 읽힌다.
--
--   주선자 입장·퇴장   누가 이 방에 들어오고 나갔는가
--   새 회원 등록       몇 번이 새로 들어왔는가
--   신청·연결          누구와 누구 사이에 무엇이 진행됐는가
--
-- ── 문장이 아니라 사실을 저장한다 ────────────────────────────
-- 본문은 비우고 `system_kind` 와 `payload` 만 남긴다. 화면이 그것으로 문장을 만든다.
-- 한국어 문장을 DB 에 박으면 문구를 고칠 때 과거 기록이 따라오지 못하고, 무엇보다
-- **이름을 적지 않기 위해서다** — 회원은 공개 번호로만 부른다(0017 의 알림과 같은 규칙).
--
-- ── 사람이 만들 수 없다 ──────────────────────────────────────
-- 시스템 메시지를 손으로 넣을 수 있으면 사건 기록이 아니라 그냥 말이 된다.
-- INSERT 정책이 `system_kind IS NULL` 만 허용하고, 만드는 것은 아래 트리거뿐이다.
-- 지우지도 못한다 — 사람의 글에만 지우기를 준다.

CREATE TYPE group_message_system_kind AS ENUM (
  'ADMIN_JOINED',
  'ADMIN_LEFT',
  'PROFILE_REGISTERED',
  'MATCH_REQUESTED',
  -- 이 제품에서 「수락」은 곧 연결이다(0021 이후 ACCEPTED 는 쓰지 않는다).
  'MATCH_INTRODUCED'
);

ALTER TABLE group_messages
  ADD COLUMN system_kind group_message_system_kind,
  -- 공개 번호와 주선자 이름만. 회원 이름·연락처·원문은 넣지 않는다.
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN group_messages.system_kind IS
  '시스템 메시지의 종류. NULL 이면 사람이 쓴 글이다. 트리거만 채운다.';

-- 사람의 글은 본문이 있고, 시스템 메시지는 본문이 없다.
ALTER TABLE group_messages DROP CONSTRAINT group_messages_body_sane;
ALTER TABLE group_messages ADD CONSTRAINT group_messages_body_sane CHECK (
  length(body) <= 2000
  AND (
    CASE
      -- 시스템 메시지: 본문 없음, 지울 수 없으므로 지운 표시도 없다.
      WHEN system_kind IS NOT NULL THEN body = '' AND deleted_at IS NULL
      -- 사람의 글: 지우기 전에는 본문이 있어야 한다.
      ELSE deleted_at IS NOT NULL OR length(btrim(body)) >= 1
    END
  )
);

-- ── 정책: 손으로 만들 수도 지울 수도 없다 ────────────────────

DROP POLICY group_messages_write ON group_messages;
CREATE POLICY group_messages_write ON group_messages FOR INSERT
  WITH CHECK (
    app_is_group_admin(group_id)
    AND author_user_id = app_current_user_id()
    AND system_kind IS NULL
  );

DROP POLICY group_messages_own_delete ON group_messages;
CREATE POLICY group_messages_own_delete ON group_messages FOR UPDATE
  USING (
    app_is_group_admin(group_id)
    AND author_user_id = app_current_user_id()
    AND system_kind IS NULL
  )
  WITH CHECK (
    app_is_group_admin(group_id)
    AND author_user_id = app_current_user_id()
    AND system_kind IS NULL
  );

-- 종류와 payload 도 나중에 바뀌지 않는다(0040·0041 의 가드에 얹는다).
CREATE OR REPLACE FUNCTION app_group_message_update_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.system_kind IS DISTINCT FROM OLD.system_kind OR NEW.payload <> OLD.payload THEN
    RAISE EXCEPTION '시스템 메시지의 내용은 바꿀 수 없습니다.';
  END IF;

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
  IF OLD.system_kind IS NOT NULL THEN
    RAISE EXCEPTION '시스템 메시지는 지울 수 없습니다.';
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

-- ── 텔레그램은 사람의 글만 ───────────────────────────────────
--
-- 시스템 메시지까지 봇이 울리면, 신청·연결은 0017 계열이 이미 알리고 있으므로
-- 같은 사건을 두 번 받는다. 방 안의 배지로만 알린다.
CREATE OR REPLACE FUNCTION app_enqueue_group_message_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.system_kind IS NOT NULL THEN
    RETURN NEW;
  END IF;

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

-- ── 시스템 메시지를 남기는 공통 경로 ─────────────────────────

/**
 * 이 사건을 일으킨 사람이 그 모임 주선자면 누구인지, 아니면 NULL.
 *
 * 작성자 자리에 넣는 값이다. 채워 두면 **자기가 한 일이 자기 배지로 뜨지 않는다**
 * (안 읽은 수가 작성자를 뺀다). 회원이 낸 신청에는 NULL 이 들어간다 — 주선자 방에
 * 회원 계정을 작성자로 박으면 이름 조인으로 회원 이름이 새어 나갈 수 있다.
 *
 * owner 커넥션으로 도는 경로(가입·초대 소비)에는 세션 GUC 가 없어 NULL 이 된다.
 * 그때는 payload 의 이름으로 누구인지 읽는다.
 */
CREATE OR REPLACE FUNCTION app_group_chat_actor(target_group uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ga.user_id
    FROM group_admins ga
   WHERE ga.group_id = target_group AND ga.user_id = app_current_user_id()
$$;
REVOKE ALL ON FUNCTION app_group_chat_actor(uuid) FROM PUBLIC;

/**
 * 방에 사건 한 줄을 남긴다.
 *
 * 방이 없는 경우를 조용히 넘긴다 — 전체공개(`group_id IS NULL`)에는 방이 없고,
 * 모임이 삭제되는 중에는 CASCADE 로 사라질 행을 새로 만들 수 없다.
 */
CREATE OR REPLACE FUNCTION app_post_group_system_message(
  target_group uuid,
  kind group_message_system_kind,
  data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF target_group IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = target_group) THEN
    RETURN;
  END IF;

  INSERT INTO group_messages (group_id, author_user_id, body, system_kind, payload)
  VALUES (target_group, app_group_chat_actor(target_group), '', kind, data);
END $$;
REVOKE ALL ON FUNCTION app_post_group_system_message(uuid, group_message_system_kind, jsonb)
  FROM PUBLIC;

-- ── 주선자 입장·퇴장 ─────────────────────────────────────────
--
-- 소속을 만드는 것은 인증 레이어뿐이라(0010) 여기가 유일한 지점이다.
-- 이름을 payload 에 적어 두는 이유: 나간 주선자는 더 이상 같은 모임이 아니라서
-- 나중에 `users` 를 읽어도 이름을 볼 수 없다.

CREATE OR REPLACE FUNCTION app_announce_group_admin_joined() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_post_group_system_message(
    NEW.group_id,
    'ADMIN_JOINED',
    jsonb_build_object(
      'actorName', (SELECT u.display_name FROM users u WHERE u.id = NEW.user_id)
    )
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_announce_group_admin_joined() FROM PUBLIC;

CREATE TRIGGER group_admins_announce_joined
  AFTER INSERT ON group_admins
  FOR EACH ROW EXECUTE FUNCTION app_announce_group_admin_joined();

CREATE OR REPLACE FUNCTION app_announce_group_admin_left() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_post_group_system_message(
    OLD.group_id,
    'ADMIN_LEFT',
    jsonb_build_object(
      'actorName', (SELECT u.display_name FROM users u WHERE u.id = OLD.user_id)
    )
  );
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION app_announce_group_admin_left() FROM PUBLIC;

CREATE TRIGGER group_admins_announce_left
  AFTER DELETE ON group_admins
  FOR EACH ROW EXECUTE FUNCTION app_announce_group_admin_left();

-- ── 새 회원 등록 ─────────────────────────────────────────────
--
-- 프로필이 생긴 시점이다. 게시 여부와 무관하게 「이 방에 사람이 늘었다」를 말한다.
-- 이름은 적지 않는다 — 공개 번호만이다.

CREATE OR REPLACE FUNCTION app_announce_profile_registered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_post_group_system_message(
    NEW.group_id,
    'PROFILE_REGISTERED',
    jsonb_build_object(
      'profileCode', NEW.public_code,
      'actorName', (SELECT u.display_name FROM users u WHERE u.id = NEW.created_by)
    )
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_announce_profile_registered() FROM PUBLIC;

CREATE TRIGGER profiles_announce_registered
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION app_announce_profile_registered();

-- ── 신청과 연결 ──────────────────────────────────────────────
--
-- 모임을 넘는 신청은 만들어질 수 없으므로(0010) 두 사람은 같은 방에 있다.
-- 신청자 쪽 소속으로 방을 정한다.

CREATE OR REPLACE FUNCTION app_announce_match_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event_kind group_message_system_kind;
  target_group uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_kind := 'MATCH_REQUESTED';
  ELSIF NEW.status = 'INTRODUCED' AND OLD.status IS DISTINCT FROM 'INTRODUCED' THEN
    event_kind := 'MATCH_INTRODUCED';
  ELSE
    RETURN NEW;
  END IF;

  SELECT p.group_id INTO target_group
    FROM profiles p WHERE p.id = NEW.requester_profile_id;

  PERFORM app_post_group_system_message(
    target_group,
    event_kind,
    jsonb_build_object(
      'requesterCode', (SELECT p.public_code FROM profiles p WHERE p.id = NEW.requester_profile_id),
      'targetCode',    (SELECT p.public_code FROM profiles p WHERE p.id = NEW.target_profile_id)
    )
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_announce_match_event() FROM PUBLIC;

CREATE TRIGGER match_requests_announce_created
  AFTER INSERT ON match_requests
  FOR EACH ROW EXECUTE FUNCTION app_announce_match_event();

CREATE TRIGGER match_requests_announce_introduced
  AFTER UPDATE OF status ON match_requests
  FOR EACH ROW EXECUTE FUNCTION app_announce_match_event();
