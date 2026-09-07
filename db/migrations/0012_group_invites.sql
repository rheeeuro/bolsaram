-- 0012: 모임 초대 코드
--
-- 각자 가입하면 각자 모임이 생겨서 같은 모임에서 함께 일할 방법이 없었다.
-- 기존 주선자가 코드를 발급하고, 받은 사람이 그 코드로 합류한다.
--
-- invites(회원 초대) · telegram_link_codes 와 같은 방식이다 — 평문을 저장하지 않고
-- pepper 를 섞은 해시만 남기며, 소비는 조건부 UPDATE 로 한 번만 성공한다.
--
-- 인증 전용 테이블이다. 정책을 만들지 않고 런타임 롤 권한을 회수한다.

CREATE TABLE group_invite_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   text NOT NULL UNIQUE,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT group_invite_codes_consume_pair CHECK (
    (consumed_at IS NULL AND consumed_by IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL)
  )
);
CREATE INDEX group_invite_codes_group_idx ON group_invite_codes (group_id, created_at DESC);

ALTER TABLE group_invite_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON group_invite_codes FROM bolsaram_app;
