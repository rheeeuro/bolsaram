-- 0059: 등록한 주선자만 보는 프로필 메모
--
-- 주선자는 등록한 분에 대해 멤버 화면에 올리지 않을 것을 따로 적어 둔다(만난 경위,
-- 성향, 주의할 점). 이 글은 **등록한 주선자만** 읽고 쓴다 — 같은 모임 주선자도,
-- 본인 멤버도 보지 못한다.
--
-- `profiles` 컬럼으로 두지 않는다. `profiles` 행은 같은 모임 주선자와 전체공개를 보는
-- 주선자 모두에게 SELECT 가 열려 있어서, 컬럼으로 두면 화면이 감춰도 RLS 로는 새어
-- 나간다. 테이블을 갈라 정책을 `app_can_edit_profile` 하나로 묶는다 — 모임에서
-- 나가면 그 프로필을 다룰 수 없게 되는 것과 같은 판정이라 메모도 함께 닫힌다.
--
-- 프로필 하나에 메모 하나다(담당이 한 사람이므로). 빈 메모는 행을 지운다.

CREATE TABLE profile_memos (
  profile_id  uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_memos_body_len CHECK (length(body) BETWEEN 1 AND 2000)
);

CREATE TRIGGER profile_memos_set_updated_at BEFORE UPDATE ON profile_memos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE profile_memos ENABLE ROW LEVEL SECURITY;

-- 읽기와 쓰기를 가르지 않는다. 읽을 수 있는 사람이 곧 쓸 수 있는 사람이다.
-- 멤버 정책은 주지 않는다 — 본인 계정이 연결돼도 주선자의 메모는 보지 못한다.
CREATE POLICY profile_memos_owner ON profile_memos FOR ALL
  USING (app_can_edit_profile(profile_id))
  WITH CHECK (app_can_edit_profile(profile_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON profile_memos TO bolsaram_app;
