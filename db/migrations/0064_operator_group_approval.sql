-- 0064: 관리자 설정과 모임 만들기 승인
--
-- 볼사람에는 주선자 위에 **관리자 한 명**이 있다. 관리자는 DB 역할이 아니라
-- 환경변수(`SEED_ADMIN_EMAIL1`)의 이메일로 정해지므로 RLS 는 관리자를 알지 못한다.
-- 그래서 아래 두 테이블은 정책을 두지 않고 런타임 롤 권한을 회수한다 — 모임 소속을
-- 만드는 일과 같은 인증 레이어(owner 커넥션)만 읽고 쓴다.
--
-- operator_settings
--   전역 설정 한 줄. `group_creation_requires_approval` 이 켜져 있으면 주선자의
--   「모임 만들기」는 모임을 바로 만들지 않고 요청만 남긴다.
--
-- group_creation_requests
--   승인 대기 중인 모임 만들기. 관리자가 승인하는 순간에만 `groups` 행이 생긴다 —
--   대기 중인 모임을 `groups` 에 두면 모임을 읽는 모든 정책·쿼리가 상태를 알아야 한다.

CREATE TABLE operator_settings (
  id                                boolean PRIMARY KEY DEFAULT true,
  group_creation_requires_approval  boolean NOT NULL DEFAULT false,
  updated_by                        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  -- 전역 설정은 한 줄뿐이다.
  CONSTRAINT operator_settings_single_row CHECK (id)
);

CREATE TRIGGER operator_settings_set_updated_at BEFORE UPDATE ON operator_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO operator_settings (id) VALUES (true);

ALTER TABLE operator_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON operator_settings FROM bolsaram_app;

CREATE TABLE group_creation_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'PENDING',
  -- 승인으로 생긴 모임. 모임이 폐쇄되면 요청 기록만 남는다.
  group_id      uuid REFERENCES groups(id) ON DELETE SET NULL,
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- `groups` 의 이름·설명 CHECK 와 같은 범위다(0053). 승인 시점에 거절당하지 않게
  -- 요청을 받을 때 같은 기준으로 막는다.
  CONSTRAINT group_creation_requests_name_len CHECK (char_length(name) BETWEEN 1 AND 20),
  CONSTRAINT group_creation_requests_description_len
    CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT group_creation_requests_status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED')),
  -- 대기 중이면 결정이 없고, 끝났으면 언제 끝났는지 있다. 승인만 모임을 가리킨다.
  CONSTRAINT group_creation_requests_decision_pair CHECK (
    (status = 'PENDING' AND decided_at IS NULL AND group_id IS NULL)
    OR (status <> 'PENDING' AND decided_at IS NOT NULL)
  )
);

CREATE INDEX group_creation_requests_pending_idx
  ON group_creation_requests (created_at) WHERE status = 'PENDING';
CREATE INDEX group_creation_requests_requester_idx
  ON group_creation_requests (requested_by, created_at DESC);

ALTER TABLE group_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON group_creation_requests FROM bolsaram_app;
