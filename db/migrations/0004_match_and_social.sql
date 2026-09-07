-- 0004: MatchRequest / Favorite / Invite / AuditLog / Session (설계문서 §9)

CREATE TABLE match_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status               match_request_status NOT NULL DEFAULT 'REQUESTED',
  message              text,
  reject_reason        text,
  introduce_note       text,

  requested_at         timestamptz NOT NULL DEFAULT now(),
  responded_at         timestamptz,
  introduced_at        timestamptz,
  closed_at            timestamptz,

  CONSTRAINT match_requests_no_self CHECK (requester_profile_id <> target_profile_id)
);

-- 같은 방향으로 활성 신청은 하나만. 부분 유니크 인덱스로 race condition 을 DB 가 막는다.
CREATE UNIQUE INDEX match_requests_one_active
  ON match_requests (requester_profile_id, target_profile_id)
  WHERE status IN ('REQUESTED','ACCEPTED','INTRODUCED');

CREATE INDEX match_requests_incoming_idx
  ON match_requests (target_profile_id, status, requested_at DESC);
CREATE INDEX match_requests_outgoing_idx
  ON match_requests (requester_profile_id, status, requested_at DESC);

-- 상태 전이 시각을 코드가 아니라 DB 가 보장한다.
CREATE OR REPLACE FUNCTION match_requests_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('ACCEPTED','REJECTED','CANCELED') THEN
      NEW.responded_at := now();
    ELSIF NEW.status = 'INTRODUCED' THEN
      NEW.introduced_at := now();
    ELSIF NEW.status = 'CLOSED' THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER match_requests_stamp_trg BEFORE UPDATE ON match_requests
  FOR EACH ROW EXECUTE FUNCTION match_requests_stamp();

-- ── Favorite ──────────────────────────────────────────────────
CREATE TABLE favorites (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, profile_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id, created_at DESC);

-- ── Invite ────────────────────────────────────────────────────
-- 평문 토큰은 저장하지 않는다. pepper 를 섞은 해시만 보관한다(설계문서 §12).
CREATE TABLE invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- 재사용(replay) 금지: claim 되면 claimed_by 가 반드시 채워진다.
  CONSTRAINT invites_claim_pair CHECK (
    (claimed_at IS NULL AND claimed_by IS NULL)
    OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL)
  )
);
CREATE INDEX invites_profile_idx ON invites (profile_id, created_at DESC);
-- 프로필당 살아 있는 초대는 하나만 유지한다.
CREATE UNIQUE INDEX invites_one_open
  ON invites (profile_id) WHERE claimed_at IS NULL AND revoked_at IS NULL;

-- ── 세션 ──────────────────────────────────────────────────────
-- 쿠키에는 세션 id 와 서명만 담고 실제 상태는 여기서 관리한다(즉시 폐기 가능).
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at DESC);

-- ── 로그인 OTP ────────────────────────────────────────────────
-- 코드도 해시로 저장한다. 시도 횟수를 제한해 무차별 대입을 막는다.
CREATE TABLE login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_phone_idx ON login_codes (phone, created_at DESC);

-- ── AuditLog ──────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  -- 사진 URL·원문 등 민감 정보는 넣지 않는다(설계문서 §12).
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
