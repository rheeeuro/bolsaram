-- 0043: 채팅의 변화를 LISTEN/NOTIFY 로 알린다
--
-- 화면이 5초마다 묻던 것을 밀어주는 방식(SSE)으로 바꾼다. 그러려면 「새 글이 들어왔다」
-- 를 요청 밖에서 알 수 있어야 한다.
--
-- ── 왜 애플리케이션이 아니라 DB 가 알리나 ────────────────────
-- 쓰기 경로에서 직접 이벤트를 쏘면 **애플리케이션이 빠뜨릴 수 있다.** 알림 아웃박스
-- (0017)와 같은 이유로 DB 에 맡긴다 — 트랜잭션이 실제로 커밋됐을 때만 나가고,
-- 커밋되지 않으면 나가지 않는다(`pg_notify` 는 커밋 시점에 전달된다).
--
-- ── payload 에 본문을 싣지 않는다 ────────────────────────────
-- 두 가지 이유다.
--   * `pg_notify` 의 payload 는 8000 바이트다. 본문은 2000자까지라 넘길 수 있다.
--   * 이 채널은 **권한 판정을 거치지 않는다.** 듣는 커넥션 하나가 모든 방의 사건을
--     받으므로, 여기에 본문이 흐르면 그 자체로 경계를 넘는다.
-- 그래서 「어느 방에서 무엇이 바뀌었다」만 알리고, 내용은 구독자가 **자기 권한으로
-- 다시 읽는다**(RLS 가 그 자리에서 다시 판정한다).

CREATE OR REPLACE FUNCTION app_broadcast_group_message() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_kind := 'created';
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    event_kind := 'deleted';
  ELSE
    -- 계정 삭제로 작성자만 비워지는 UPDATE(0041) 는 화면에 알릴 것이 없다.
    RETURN NEW;
  END IF;

  PERFORM pg_notify(
    'bolsaram_group_chat',
    json_build_object(
      'kind', event_kind,
      'groupId', NEW.group_id,
      'messageId', NEW.id,
      -- 구독자가 놓친 구간을 되짚는 커서. 저장 정밀도와 같은 밀리초다(0042).
      'at', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );
  RETURN NEW;
END $$;

CREATE TRIGGER group_messages_broadcast_created
  AFTER INSERT ON group_messages
  FOR EACH ROW EXECUTE FUNCTION app_broadcast_group_message();

CREATE TRIGGER group_messages_broadcast_deleted
  AFTER UPDATE OF deleted_at ON group_messages
  FOR EACH ROW EXECUTE FUNCTION app_broadcast_group_message();
