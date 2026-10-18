-- 0072: 같은 원문은 주선자를 가리지 않고 한 번만 받는다
--
-- 앱은 가져오기를 만들거나 원문을 고치기 전에 같은 `raw_text_key`(0071)의 가져오기를 찾아
-- 있으면 거절한다. 그런데 가져오기는 올린 주선자만 본다(`import_sessions_admin`) — 다른
-- 주선자가 같은 사람을 이미 올렸어도 런타임 롤로는 보이지 않는다.
--
-- 그래서 **있는지 없는지만** 답하는 함수를 둔다. 누가 올렸는지·어느 프로필인지·원문은
-- 돌려주지 않는다. 묻는 쪽이 이미 그 글을 가지고 있어야 물을 수 있으므로, 새로 드러나는
-- 것은 「이 글이 볼사람 어딘가에 이미 있다」는 사실 하나다. 주선자(ADMIN)만 부를 수 있다.
--
-- 대상은 앱의 검사와 같다 — 등록 전 가져오기와, 프로필이 남아 있는 등록된 가져오기.

CREATE FUNCTION app_import_raw_text_taken(raw text, except_session uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  key text := import_raw_text_key(raw);
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION '주선자만 확인할 수 있습니다.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF key IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM import_sessions s
      LEFT JOIN profiles p ON p.id = s.committed_profile_id
     WHERE s.raw_text_key = key
       AND s.id IS DISTINCT FROM except_session
       AND (s.status <> 'IMPORTED' OR p.id IS NOT NULL)
  );
END
$$;
REVOKE ALL ON FUNCTION app_import_raw_text_taken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_import_raw_text_taken(text, uuid) TO bolsaram_app;
