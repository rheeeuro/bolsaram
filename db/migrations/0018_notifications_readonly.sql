-- 0018: 알림은 런타임 롤에서 읽기 전용
--
-- 0017 이 `GRANT SELECT` 만 줬지만, 0001 의 ALTER DEFAULT PRIVILEGES 가 새로 만든
-- 테이블에 INSERT/UPDATE/DELETE 를 자동으로 준다(0009 가 같은 이유로 회수했다).
--
-- 지금은 정책이 없어서 실제로는 0행이 바뀐다 — 오류도 나지 않아 조용히 통과한 것처럼
-- 보인다. 정책 하나만 잘못 추가하면 그 순간 열리므로, **권한 자체를 회수해** 두 겹으로
-- 막는다. 알림을 임의로 만들 수 있으면 남의 봇으로 아무 메시지나 보낼 수 있고,
-- 보낸 것으로 표시할 수 있으면 알림을 조용히 없앨 수 있다.
--
-- 만드는 것은 트리거(owner 소유 SECURITY DEFINER), 보냈다고 표시하는 것은
-- 디스패처(owner) 뿐이라는 0017 의 의도를 권한으로 못 박는 것이다.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON notifications FROM bolsaram_app;
