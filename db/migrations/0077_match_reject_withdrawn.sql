-- 0077: 거절을 거둔 신청 — WITHDRAWN
--
-- 거절은 어느 방향으로도 다시 신청하지 못하게 막는다(0023). 받은 쪽이 마음을 바꿔도
-- 풀 길이 없었다. 받은 쪽 담당 주선자가 본인 뜻을 확인하고 그 거절을 거두면
-- 신청이 WITHDRAWN 으로 닫히고, 거절로 막힌 사이가 풀린다.
--
-- 거절을 REQUESTED 로 되살리지 않고 따로 닫는 이유: 신청자는 이미 거절을 전해 들었고
-- 그 마음이 지금도 같은지 알 수 없다. 원래 신청을 살려 바로 수락하면 신청자의
-- 지난 동의만으로 연락처가 열린다. 연결하려면 거절했던 쪽이 새로 마음을 보내고
-- 신청자가 다시 수락해야 한다.
--
-- 막힘 판정(app_is_rejected_between · app_discover_excluded_profile_ids ·
-- match_requests_block_closed_relations)은 모두 status = 'REJECTED' 만 보므로
-- 상태가 바뀌는 것만으로 풀린다. 함수는 고치지 않는다.
--
-- 새 enum 값은 이 트랜잭션 안에서 쓸 수 없다. 정책은 0078 에서 고친다.

ALTER TYPE match_request_status ADD VALUE IF NOT EXISTS 'WITHDRAWN';
