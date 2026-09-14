-- 0045: 방은 들어온 시점부터 보인다
--
-- 0040 은 방에 합류하면 그동안의 대화가 전부 보이게 했다. 새로 온 주선자가 경위를
-- 따라잡는 데 낫다고 봤기 때문이다. 그런데 그 대화는 **그 사람이 오기 전에 오간 말**
-- 이다 — 동료들이 자기들끼리 나눈 판단과 표현이 뒤늦게 통째로 열린다. 초대 코드 하나로
-- 과거 전부가 따라오는 것은 방을 쓰는 사람들이 기대하는 바가 아니다.
--
-- 입장한 시점부터 보게 바꾼다. 자기 입장 기록(`ADMIN_JOINED`)이 그 방에서 보는
-- 첫 줄이 된다.
--
-- ── 왜 정책인가 ──────────────────────────────────────────────
-- 목록·스트림·안 읽은 수가 모두 같은 테이블을 읽는다. 애플리케이션에서 걸러내면 세 곳을
-- 각각 맞춰야 하고, 한 곳을 빠뜨리면 그 경로로 과거가 샌다. 정책 하나로 막으면 어느
-- 경로로 읽어도 같은 기준이 선다.
--
-- ── 밀리초로 내려서 비교한다 ─────────────────────────────────
-- `group_admins.added_at` 은 마이크로초까지 저장되고 `group_messages.created_at` 은
-- 밀리초다(0042). 같은 트랜잭션에서 만들어지므로 값이 같은데, 정밀도를 맞추지 않으면
-- **자기 입장 기록이 자기 기준보다 이르다**고 판정되어 빠진다.

/**
 * 이 방에서 내가 볼 수 있는 가장 이른 시각. 속하지 않았으면 NULL 이다.
 *
 * 나갔다가 다시 들어오면 그때부터다 — `group_admins` 행이 새로 생기기 때문이다.
 * 한 주선자가 여러 모임에 속하므로 판정은 모임마다 따로 선다.
 */
CREATE OR REPLACE FUNCTION app_group_chat_visible_from(target_group uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc('milliseconds', ga.added_at)
    FROM group_admins ga
   WHERE ga.group_id = target_group AND ga.user_id = app_current_user_id()
$$;
REVOKE ALL ON FUNCTION app_group_chat_visible_from(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_group_chat_visible_from(uuid) TO bolsaram_app;

DROP POLICY group_messages_read ON group_messages;
CREATE POLICY group_messages_read ON group_messages FOR SELECT
  USING (
    app_is_group_admin(group_id)
    AND created_at >= app_group_chat_visible_from(group_id)
  );

-- 지우기는 자기 글에만 준다(0040). 자기 글은 언제나 자기 입장 뒤에 있으므로
-- UPDATE 정책은 손대지 않는다.
