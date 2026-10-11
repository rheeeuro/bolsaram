-- 봇 대화에 「완료」 종착점을 둔다.
--
-- 대화 하나는 프로필 하나다. 그런데 열린 대화를 닫는 길이 취소·만료뿐이라,
-- 등록을 마친 뒤에도 대화가 열린 채 남아 다음 사람의 사진과 글이 이미 등록된
-- Import 에 붙었다(분석은 CONFLICT 로 실패). 봇이 다음 사람이 시작됐다고 판단하면
-- 이전 대화를 COMPLETED 로 닫고 새 대화를 연다. 판정은 도메인
-- (`conversationRollover`)이 하고, 이 값은 one_active 인덱스의 열린 상태에
-- 들어가지 않으므로 새 대화와 겹치지 않는다.
ALTER TYPE telegram_session_state ADD VALUE IF NOT EXISTS 'COMPLETED';
