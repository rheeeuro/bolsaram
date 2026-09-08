-- 0023: 거절 이후 — 재신청 금지 · 숨기기
--
-- 지금까지 거절은 상태 하나만 남기고 끝났다. 거절된 상대가 탐색에 계속 뜨고, 활성
-- 신청만 없으면 곧바로 다시 신청할 수 있었다(0004 의 부분 유니크 인덱스는
-- REQUESTED/INTRODUCED 만 본다). 받는 쪽이 같은 사람에게 반복해서 거절을 눌러야 한다.
--
-- 여기서 두 가지를 더한다.
--
--   1) 거절된 관계에는 **어느 방향으로도** 다시 신청하지 못한다.
--   2) 회원이 상대를 직접 **숨긴다**. 숨기면 서로 탐색에서 빠지고 서로 신청도 못 한다.
--
-- 둘 다 "관계"이므로 방향을 구분하지 않는다. 한쪽만 막으면 A→B 는 못 하는데 B→A 는
-- 되는 상태가 생기고, 탐색 목록과 신청 가능 여부가 어긋난다.
--
-- 재신청 금지를 유니크 인덱스로 넓히지 않은 이유: 인덱스는 이미 쌓인 REJECTED 이력이
-- 같은 방향으로 둘 이상이면 생성 자체가 실패하고, 그것을 맞추려면 이력을 지워야 한다.
-- 트리거는 새 삽입만 보므로 이력을 건드리지 않는다.

-- ── profile_hides ─────────────────────────────────────────────
-- 회원 사이의 관계이므로 user_id 가 아니라 profile_id 로 잡는다(favorites 와 다르다).
-- 탐색 제외와 신청 차단이 모두 프로필 단위로 판정되기 때문이다.
CREATE TABLE profile_hides (
  hider_profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hidden_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hider_profile_id, hidden_profile_id),
  CONSTRAINT profile_hides_no_self CHECK (hider_profile_id <> hidden_profile_id)
);

-- 반대 방향 조회용. "나를 숨긴 사람" 을 찾을 때 쓴다.
CREATE INDEX profile_hides_hidden_idx ON profile_hides (hidden_profile_id);

ALTER TABLE profile_hides ENABLE ROW LEVEL SECURITY;

-- 자기가 숨긴 것만 읽고 쓴다. **누가 나를 숨겼는지는 읽을 수 없다** — 그것을 보여주면
-- 숨기기가 상대에게 통보되는 것과 같다. 판정만 필요한 곳은 아래 SECURITY DEFINER
-- 함수를 쓴다. 주선자에게도 정책을 주지 않는다: 신고가 아니라 숨기기이므로 운영이
-- 들여다볼 이유가 없다.
CREATE POLICY profile_hides_own ON profile_hides FOR ALL
  USING (hider_profile_id = app_current_profile_id())
  WITH CHECK (hider_profile_id = app_current_profile_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON profile_hides TO bolsaram_app;

-- ── 관계 판정 ─────────────────────────────────────────────────
-- 어느 방향이든 거절이 있었는가. RLS 로 보이는 행에 의존하면 안 되므로 DEFINER 다.
CREATE OR REPLACE FUNCTION app_is_rejected_between(other_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_requests mr
    WHERE mr.status = 'REJECTED'
      AND (
        (mr.requester_profile_id = app_current_profile_id() AND mr.target_profile_id = other_profile_id)
        OR
        (mr.target_profile_id = app_current_profile_id() AND mr.requester_profile_id = other_profile_id)
      )
  )
$$;
REVOKE ALL ON FUNCTION app_is_rejected_between(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_rejected_between(uuid) TO bolsaram_app;

-- 어느 방향이든 숨김이 있었는가. 상대가 나를 숨긴 경우도 여기서만 알 수 있다 —
-- boolean 만 나가므로 누가 숨겼는지는 드러나지 않는다.
CREATE OR REPLACE FUNCTION app_is_hidden_between(other_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_hides h
    WHERE (h.hider_profile_id = app_current_profile_id() AND h.hidden_profile_id = other_profile_id)
       OR (h.hider_profile_id = other_profile_id AND h.hidden_profile_id = app_current_profile_id())
  )
$$;
REVOKE ALL ON FUNCTION app_is_hidden_between(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_hidden_between(uuid) TO bolsaram_app;

/**
 * 탐색 목록에서 빠져야 하는 프로필 id 전부.
 *
 * 프로필마다 판정 함수를 부르면 목록 조회가 행 수만큼 서브쿼리를 돌린다. 한 번 불러
 * 집합으로 받고 `NOT IN` 으로 거른다 — STABLE 이므로 쿼리당 한 번만 평가된다.
 * 프로필이 없는 주선자(app_current_profile_id() IS NULL)에게는 빈 집합이다.
 */
CREATE OR REPLACE FUNCTION app_discover_excluded_profile_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN mr.requester_profile_id = app_current_profile_id()
              THEN mr.target_profile_id ELSE mr.requester_profile_id END
    FROM match_requests mr
   WHERE mr.status = 'REJECTED'
     AND app_current_profile_id() IN (mr.requester_profile_id, mr.target_profile_id)
  UNION
  SELECT CASE WHEN h.hider_profile_id = app_current_profile_id()
              THEN h.hidden_profile_id ELSE h.hider_profile_id END
    FROM profile_hides h
   WHERE app_current_profile_id() IN (h.hider_profile_id, h.hidden_profile_id)
$$;
REVOKE ALL ON FUNCTION app_discover_excluded_profile_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_discover_excluded_profile_ids() TO bolsaram_app;

-- ── 신청 차단 ─────────────────────────────────────────────────
/**
 * 거절·숨김 관계에는 새 신청을 만들지 못한다.
 *
 * 애플리케이션 레이어(assertCanCreateRequest)가 같은 판정을 먼저 하고 사람이 읽을
 * 메시지를 준다. 이 트리거는 그것을 대체하지 않고 최종 방어선으로 남는다 —
 * 주선자 경로나 앞으로 생길 다른 경로가 검사를 빠뜨려도 DB 가 막는다.
 *
 * DEFINER 로 두는 이유는 판정이 호출자에게 보이는 행에 좌우되면 안 되기 때문이다.
 * 삽입하는 본인이 당사자라 정책상으로도 보이지만, 그 사실에 기대지 않는다.
 */
CREATE OR REPLACE FUNCTION match_requests_block_closed_relations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM match_requests mr
    WHERE mr.status = 'REJECTED'
      AND (
        (mr.requester_profile_id = NEW.requester_profile_id AND mr.target_profile_id = NEW.target_profile_id)
        OR
        (mr.requester_profile_id = NEW.target_profile_id AND mr.target_profile_id = NEW.requester_profile_id)
      )
  ) THEN
    RAISE EXCEPTION '거절된 관계에는 다시 신청할 수 없습니다.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM profile_hides h
    WHERE (h.hider_profile_id = NEW.requester_profile_id AND h.hidden_profile_id = NEW.target_profile_id)
       OR (h.hider_profile_id = NEW.target_profile_id AND h.hidden_profile_id = NEW.requester_profile_id)
  ) THEN
    RAISE EXCEPTION '숨긴 관계에는 신청할 수 없습니다.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER match_requests_block_closed_relations_trg BEFORE INSERT ON match_requests
  FOR EACH ROW EXECUTE FUNCTION match_requests_block_closed_relations();
