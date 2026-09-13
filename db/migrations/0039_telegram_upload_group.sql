-- 0039: 텔레그램 봇이 담을 모임을 연결 설정에 둔다
--
-- 0036 이후 봇 Import 는 `users.active_group_id` — 웹에서 보고 있는 채널 — 를 그대로
-- 따라갔다. 한 화면에서 일할 때는 맞았지만, 웹에서 다른 모임을 들여다보는 동안 봇으로
-- 사진을 보내면 담기는 곳이 같이 움직인다. 카카오톡에서 프로필을 받아 봇으로 넘기는
-- 흐름은 웹을 보고 있지 않을 때가 대부분이라, 담을 곳은 **연결 설정에 붙는 값**이어야
-- 한다.
--
--   NULL     → 전체공개 채널 (연결 직후 기본값이자 웹 업로드와 같은 자리)
--   NOT NULL → 그 모임
--
-- `active_group_id` 와 성격은 같다 — **권한이 아니라 목적지**다. 여기에 무엇을 넣든
-- 볼 수 있는 범위는 늘지 않는다. 속하지 않은 모임으로 Import 를 만들려 하면
-- `import_sessions_admin` 의 WITH CHECK 가 막는다. 그래도 조용히 빈 곳을 가리키지
-- 않도록 이 컬럼 자체에도 소속 조건을 건다.

ALTER TABLE telegram_connections
  ADD COLUMN upload_group_id uuid REFERENCES groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN telegram_connections.upload_group_id IS
  '봇으로 보낸 프로필을 담을 모임. NULL 이면 전체공개. 권한이 아니라 목적지이며 소속은 group_admins 가 정한다.';

-- 지금까지 쓰던 값(보고 있던 채널)을 그대로 옮겨 이번 배포에서 담기는 곳이 달라지지
-- 않게 한다. 소속이 아닌 채널이 남아 있을 수 있으므로 group_admins 로 한 번 거른다.
UPDATE telegram_connections c
   SET upload_group_id = (
         SELECT ga.group_id FROM group_admins ga
          JOIN users u ON u.id = ga.user_id AND u.active_group_id = ga.group_id
         WHERE ga.user_id = c.user_id
       );

-- ── 속하지 않은 모임은 넣을 수 없다 ──────────────────────────
-- 연결 행 자체는 여전히 주선자 개인 것이다(0010). 목적지 조건만 더한다.
DROP POLICY telegram_connections_own ON telegram_connections;
CREATE POLICY telegram_connections_own ON telegram_connections FOR ALL
  USING (user_id = app_current_user_id() AND app_is_admin())
  WITH CHECK (
    user_id = app_current_user_id()
    AND app_is_admin()
    AND (upload_group_id IS NULL OR app_is_group_admin(upload_group_id))
  );

-- ── 소속이 끊기면 목적지도 따라 끊는다 ───────────────────────
--
-- 모임 삭제는 위 FK 의 ON DELETE SET NULL 이 처리한다. 남는 것은 **나가기** 다 —
-- `group_admins` 행만 사라지고 이 컬럼은 그 모임을 가리킨 채 남는다.
-- 활성 채널과 같은 방식으로(0036) 트리거로 잠근다.
CREATE OR REPLACE FUNCTION clear_telegram_upload_group_on_leave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE telegram_connections
     SET upload_group_id = NULL
   WHERE user_id = OLD.user_id AND upload_group_id = OLD.group_id;
  RETURN OLD;
END
$$;

CREATE TRIGGER group_admins_clear_telegram_upload_group
  AFTER DELETE ON group_admins
  FOR EACH ROW EXECUTE FUNCTION clear_telegram_upload_group_on_leave();
