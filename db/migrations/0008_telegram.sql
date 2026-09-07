-- 0008: Telegram Import 채널 (설계 변경 문서 TELEGRAM v1 §7·§8·§14)
--
-- Import 도메인(import_sessions/import_assets/import_extractions)은 그대로 두고
-- 입력 채널만 추가한다. 여기 테이블은 전부 "텔레그램 대화를 ImportSession 에
-- 붙이기 위한 부속물"이며, 프로필 데이터는 하나도 담지 않는다.
--
-- 권한 모델이 두 갈래다.
--   * telegram_link_codes / telegram_webhook_events
--     → 정책을 만들지 않고 bolsaram_app 에서 권한을 회수한다. sessions/login_codes 와
--       같은 취급이다. webhook 은 세션 쿠키가 없으므로 "누가 보냈는지" 판정은
--       인증 레이어(owner 커넥션)에서만 한다.
--   * telegram_connections / telegram_import_sessions
--     → 관리자 정책을 준다. 신원 확인이 끝난 뒤의 모든 작업은 연결된 주선자 명의로
--       withRls 를 통과한다. 즉 webhook 도 RLS 를 우회하지 않는다.

ALTER TYPE import_source ADD VALUE IF NOT EXISTS 'TELEGRAM';

-- 봇 대화 진행 상태. import_status 와 합치지 않는다 — 전자는 "대화가 어디까지
-- 왔는가", 후자는 "Import 가 어디까지 왔는가"로 축이 다르다.
CREATE TYPE telegram_session_state AS ENUM
  ('WAITING_MEDIA', 'WAITING_TEXT', 'READY', 'CANCELED', 'EXPIRED');

-- ── 계정 연결 ─────────────────────────────────────────────────
-- 봇은 검색으로 누구나 찾을 수 있다. 여기 없는 텔레그램 사용자는 아무것도 못 한다.
CREATE TABLE telegram_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 주선자 한 명 ↔ 텔레그램 계정 하나. 양방향 UNIQUE 로 잠근다.
  user_id          uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL UNIQUE,
  -- 봇이 답장을 보낼 대화. 1:1 대화라 보통 telegram_user_id 와 같지만 별도로 둔다.
  telegram_chat_id bigint NOT NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER telegram_connections_set_updated_at BEFORE UPDATE ON telegram_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 연결 코드 ─────────────────────────────────────────────────
-- invites 와 같은 방식: 평문을 저장하지 않고 pepper 를 섞은 해시만 남긴다.
-- 소비는 조건부 UPDATE 로 한 번만 성공하게 만든다(replay 차단).
CREATE TABLE telegram_link_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash    text NOT NULL UNIQUE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  consumed_by  bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT telegram_link_codes_consume_pair CHECK (
    (consumed_at IS NULL AND consumed_by IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL)
  )
);
-- 주선자당 살아 있는 코드는 하나. 새로 발급하면 이전 것을 지운다.
CREATE UNIQUE INDEX telegram_link_codes_one_open
  ON telegram_link_codes (user_id) WHERE consumed_at IS NULL;

-- ── 봇 대화 ───────────────────────────────────────────────────
CREATE TABLE telegram_import_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id uuid NOT NULL UNIQUE
                      REFERENCES import_sessions(id) ON DELETE CASCADE,
  telegram_user_id  bigint NOT NULL,
  telegram_chat_id  bigint NOT NULL,
  -- 앨범(사진 여러 장 동시 전송)은 같은 media_group_id 로 여러 update 에 나뉘어 온다.
  -- 사진을 묶는 것은 세션이 하므로 버퍼링은 필요 없고, 이 값은 같은 앨범에 대해
  -- 안내 메시지를 한 번만 보내기 위해서만 쓴다.
  last_media_group_id text,
  state             telegram_session_state NOT NULL DEFAULT 'WAITING_MEDIA',
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER telegram_import_sessions_set_updated_at
  BEFORE UPDATE ON telegram_import_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 텔레그램 사용자당 진행 중인 대화는 하나.
-- "사진 여러 장이 하나의 ImportSession 으로 묶인다"를 DB 가 보장하는 지점이다.
CREATE UNIQUE INDEX telegram_import_sessions_one_active
  ON telegram_import_sessions (telegram_user_id)
  WHERE state IN ('WAITING_MEDIA', 'WAITING_TEXT', 'READY');
CREATE INDEX telegram_import_sessions_stale_idx
  ON telegram_import_sessions (state, last_activity_at);

-- ── webhook 멱등성 ───────────────────────────────────────────
-- update_id 는 봇 단위로 유일하고 증가한다(Bot API «Update»). 같은 update 가
-- 재전송되면 여기서 걸린다. payload 자체는 저장하지 않는다(설계 변경 §15).
CREATE TABLE telegram_webhook_events (
  update_id    bigint PRIMARY KEY,
  event_type   text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX telegram_webhook_events_received_idx
  ON telegram_webhook_events (received_at);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE telegram_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_connections_admin ON telegram_connections FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE telegram_import_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_import_sessions_admin ON telegram_import_sessions FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- 인증 전용: 정책을 만들지 않고 기본 권한도 회수한다(0001 의 ALTER DEFAULT
-- PRIVILEGES 가 새 테이블에 자동으로 권한을 주므로 명시적으로 되돌려야 한다).
ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON telegram_link_codes FROM bolsaram_app;
REVOKE ALL ON telegram_webhook_events FROM bolsaram_app;
