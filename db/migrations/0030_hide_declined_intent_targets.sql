-- 0030: 주선자가 보류한 상대는 회원 목록에서 뺀다
--
-- 0026 이후 회원의 「마음 보내기」는 요청이고 주선자가 확인해야 전달된다. 주선자가
-- 보류하면 그 사실을 회원에게 알릴 길이 없다 — 회원용 알림 채널을 만들지 않기로
-- 했기 때문이다(2026-09-08). 주선자가 카카오톡으로 알려주는 것이 실제 흐름이다.
--
-- 문제는 화면이다. 보류된 뒤에도 그 상대가 목록에 계속 보이면 회원은 왜 아무 일도
-- 일어나지 않는지 모른 채 다시 누르게 된다. 그래서 **조용히 목록에서 뺀다.**
-- 거절·숨김과 같은 처리이고, 같은 함수에 얹으므로 탐색과 관심 목록이 함께 따라온다.
--
-- 방향이 다르다는 점만 주의한다. 거절·숨김은 양방향이지만 보류는 **한 방향**이다 —
-- 요청을 낸 사람에게서 상대를 가릴 뿐, 상대는 아무것도 하지 않았으므로 그쪽 목록은
-- 건드리지 않는다.
--
-- 신청 자체를 막지는 않는다. 보류는 「지금은 아니다」이지 영구 차단이 아니다.
-- 사정이 바뀌면 주선자가 다시 이어줄 수 있어야 한다(거절은 0023 이 영구히 막는다).

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
  UNION
  -- 보류된 「마음 보내기」의 상대. 한 방향이다.
  SELECT mi.target_profile_id
    FROM match_intents mi
   WHERE mi.profile_id = app_current_profile_id()
     AND mi.kind = 'SEND'
     AND mi.status = 'DECLINED'
     AND mi.target_profile_id IS NOT NULL
$$;
