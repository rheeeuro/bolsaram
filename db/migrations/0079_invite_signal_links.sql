-- 0079: 받은 신청 알림 링크 — invites.purpose
--
-- 주선자가 받은 신청을 카카오톡으로 알릴 때, 이미 들어온 분에게는 그분 계정으로
-- 로그인시키는 링크가 필요하다(신원 없는 시그널 주소는 그 기기 쿠키의 계정으로 열린다).
-- 입장 링크를 다시 발급하면 기존 링크와 세션이 모두 끝나므로, 그것과 **나란히 사는**
-- 알림 링크를 따로 둔다.
--
--   ENTRY  — 입장 링크. 프로필당 하나, 새로 발급하면 이전 것을 모두 회수한다.
--            처음 열기 전까지만 기한을 보고, 연결된 뒤에는 회수될 때까지 유효하다.
--   SIGNAL — 알림 링크. 이미 계정이 있는 프로필에만, 발급 때부터 그 계정에 연결된 채로
--            만든다. 기존 링크를 회수하지 않고, 연결돼 있어도 기한(expires_at)이 지나면 끝난다.
--            입장 링크를 다시 발급하면 함께 회수된다.

ALTER TABLE invites
  ADD COLUMN purpose text NOT NULL DEFAULT 'ENTRY'
    CONSTRAINT invites_purpose CHECK (purpose IN ('ENTRY', 'SIGNAL'));

-- 알림 링크는 새 계정을 만드는 경로가 아니다 — 처음부터 연결된 상태여야 한다.
ALTER TABLE invites
  ADD CONSTRAINT invites_signal_claimed CHECK (purpose = 'ENTRY' OR claimed_at IS NOT NULL);
