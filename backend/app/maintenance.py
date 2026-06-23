"""유지보수 배치. 장기 미활동 후보를 자동 비공개 처리한다.

PM2 cron(bolsaram-maintenance)에서 매일 1회 `python -m backend.app.maintenance`로 실행된다.
활동 기준은 candidates.updated_at(등록/수정/상태변경 시 갱신)이다.
"""

from __future__ import annotations

from .main import execute, fetch_all, today_label

INACTIVE_DAYS = 180


def run() -> int:
    rows = fetch_all(
        "SELECT id, room_id, status FROM candidates WHERE privacy <> '비공개' AND updated_at < (NOW() - INTERVAL %s DAY)",
        (INACTIVE_DAYS,),
    )
    for row in rows:
        execute("UPDATE candidates SET privacy = '비공개' WHERE id = %s", (row["id"],))
        execute(
            "INSERT INTO match_logs (room_id, candidate_id, status, log_date, memo) VALUES (%s, %s, %s, %s, %s)",
            (row["room_id"], row["id"], row["status"], today_label(), f"자동 비공개({INACTIVE_DAYS}일 미활동)"),
        )
    return len(rows)


if __name__ == "__main__":
    count = run()
    print(f"[bolsaram-maintenance] auto-private swept: {count}")
