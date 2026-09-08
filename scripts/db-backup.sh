#!/usr/bin/env bash
#
# 볼사람 DB 백업.
#
# 지금까지 백업이 없었다. 실회원이 생긴 뒤에 컨테이너 볼륨을 잃으면 프로필·연결 기록이
# 그대로 사라진다 — 주선자가 카카오톡에서 다시 모아야 한다는 뜻이다.
#
#   scripts/db-backup.sh           백업 한 개 만들고 오래된 것 정리
#   scripts/db-backup.sh --verify  가장 최근 백업을 임시 DB 로 되살려 확인
#   scripts/db-backup.sh --list    가진 백업 목록
#
# 주의: **기본 백업은 같은 호스트에 쌓인다.** 디스크가 통째로 죽는 경우는 못 막는다.
# 막는 것은 실수로 지운 데이터, 잘못된 마이그레이션, 컨테이너 볼륨 손상이다.
#
# 다른 디스크·마운트에 사본을 두려면 환경변수 `BACKUP_MIRROR_DIR` 에 경로를 준다.
# 백업이 성공한 뒤에만 복사하고, 거기서도 같은 개수만 남긴다. 경로가 없으면
# **경고만 하고 기본 백업은 유지한다** — 마운트가 빠졌다고 백업 자체를 잃으면 안 된다.
#
# 덤프에는 실명·연락처가 들어 있다. 디렉터리는 700, 파일은 600 으로 만들고
# 에이전트 가드가 var/backup 열람을 막는다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$ROOT/var/backup"
CONTAINER="bolsaram_postgres"
DB="bolsaram"
OWNER="bolsaram_owner"
# 보관 개수. 매일 한 번이므로 2주치다.
KEEP=14

cd "$ROOT"

fail() { echo "✗ $*" >&2; exit 1; }

# 환경변수는 리포 루트의 한 파일로 관리한다. 웹 앱은 next.config 가 읽어주지만 셸
# 스크립트는 아니므로, 필요한 값 하나만 직접 꺼낸다(주석·따옴표를 걷어낸다).
if [ -z "${BACKUP_MIRROR_DIR:-}" ] && [ -f "$ROOT/.env" ]; then
  BACKUP_MIRROR_DIR="$(
    sed -n 's/^[[:space:]]*BACKUP_MIRROR_DIR[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" |
      tail -n 1 | sed 's/[[:space:]]*#.*$//' | tr -d "\"'"
  )"
fi

docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "$CONTAINER 컨테이너가 없습니다. pnpm db:up 을 먼저 실행하세요."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

latest_backup() {
  ls -1t "$BACKUP_DIR"/bolsaram-*.dump 2>/dev/null | head -n 1
}

case "${1:-}" in
  --list)
    ls -lh "$BACKUP_DIR"/bolsaram-*.dump 2>/dev/null || echo "백업이 없습니다."
    exit 0
    ;;

  --verify)
    # 「백업이 있다」와 「되살릴 수 있다」는 다른 말이다. 실제로 되살려 본다.
    SRC="$(latest_backup)" || true
    [ -n "${SRC:-}" ] || fail "백업이 없습니다."
    VERIFY_DB="bolsaram_verify_$$"
    echo "· 대상: $(basename "$SRC")"

    cleanup() {
      docker exec "$CONTAINER" dropdb -U "$OWNER" --if-exists "$VERIFY_DB" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT

    docker exec "$CONTAINER" createdb -U "$OWNER" "$VERIFY_DB"
    # pg_restore 는 이미 있는 확장·롤에 대해 경고를 낸다. 실패만 본다.
    docker exec -i "$CONTAINER" pg_restore -U "$OWNER" -d "$VERIFY_DB" --no-owner < "$SRC" >/dev/null 2>&1 || true

    echo "· 복구된 행 수"
    docker exec "$CONTAINER" psql -U "$OWNER" -d "$VERIFY_DB" -c "
      SELECT
        (SELECT count(*) FROM profiles)       AS profiles,
        (SELECT count(*) FROM users)          AS users,
        (SELECT count(*) FROM match_requests) AS match_requests,
        (SELECT count(*) FROM groups)         AS groups,
        (SELECT count(*) FROM schema_migrations) AS migrations"

    # 스키마만 돌아오고 데이터가 비면 백업이 있으나 마나다.
    COUNT="$(docker exec "$CONTAINER" psql -U "$OWNER" -d "$VERIFY_DB" -tAc "SELECT count(*) FROM profiles")"
    [ "$COUNT" -gt 0 ] || fail "복구된 프로필이 0건입니다. 백업을 신뢰할 수 없습니다."
    echo "✓ 복구 확인 완료 (임시 DB 는 삭제했습니다)"
    exit 0
    ;;

  "")
    ;;
  *)
    fail "알 수 없는 옵션: $1"
    ;;
esac

STAMP="$(date +%Y%m%d-%H%M)"
TARGET="$BACKUP_DIR/bolsaram-$STAMP.dump"

# -Fc: 압축된 custom 포맷. 테이블 단위 복구가 되고 pg_restore 로 검사할 수 있다.
umask 077
docker exec "$CONTAINER" pg_dump -U "$OWNER" -Fc "$DB" > "$TARGET"

# 잘린 덤프는 파일이 있는 것처럼 보여서 더 위험하다. 목록을 읽어 형태를 확인한다.
if ! docker exec -i "$CONTAINER" pg_restore --list < "$TARGET" > /dev/null 2>&1; then
  rm -f "$TARGET"
  fail "덤프가 온전하지 않아 버렸습니다."
fi

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "✓ 백업 완료: $(basename "$TARGET") ($SIZE)"

# 다른 디스크로 사본. 실패해도 기본 백업은 이미 만들어져 있다.
if [ -n "${BACKUP_MIRROR_DIR:-}" ]; then
  if mkdir -p "$BACKUP_MIRROR_DIR" 2>/dev/null; then
    chmod 700 "$BACKUP_MIRROR_DIR" 2>/dev/null || true
    if cp "$TARGET" "$BACKUP_MIRROR_DIR/"; then
      echo "· 사본: $BACKUP_MIRROR_DIR"
      mapfile -t MIRROR_OLD < <(
        ls -1t "$BACKUP_MIRROR_DIR"/bolsaram-*.dump 2>/dev/null | tail -n +$((KEEP + 1))
      )
      [ ${#MIRROR_OLD[@]} -gt 0 ] && rm -f "${MIRROR_OLD[@]}"
    else
      echo "⚠️  사본을 만들지 못했습니다: $BACKUP_MIRROR_DIR" >&2
    fi
  else
    echo "⚠️  사본 경로를 쓸 수 없습니다: $BACKUP_MIRROR_DIR" >&2
  fi
fi

# 오래된 것 정리. 최신 $KEEP 개만 남긴다.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/bolsaram-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
if [ ${#OLD[@]} -gt 0 ]; then
  rm -f "${OLD[@]}"
  echo "· 오래된 백업 ${#OLD[@]}개 정리"
fi
