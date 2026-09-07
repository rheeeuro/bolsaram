---
name: db-query
description: 볼사람 PostgreSQL 데이터를 조회한다. 사용자가 DB 확인, 데이터 조회, 테이블 상태, 스키마 확인을 요청할 때 사용한다.
---

# DB 조회

컨테이너는 `bolsaram_postgres` (`127.0.0.1:5442`, DB `bolsaram`). 비밀번호는
`docker-compose.yml` 에만 두고 문서·명령에 옮겨 적지 않는다.

```bash
docker exec bolsaram_postgres psql -U bolsaram_owner -d bolsaram -tAc "<SQL>"
# 대화형
docker exec -it bolsaram_postgres psql -U bolsaram_owner -d bolsaram
```

## 롤 두 개를 구분할 것

- `bolsaram_owner` — 마이그레이션·시드·인증 경로. **RLS 를 우회한다.**
- `bolsaram_app` — 런타임. `NOBYPASSRLS` 라 정책을 통과해야 한다.

owner 로 조회하면 정책이 적용되지 않으므로, **"회원에게 보이는가"를 확인할 때는
owner psql 로 판단하지 말 것.** RLS 동작은 `tests/rls.test.ts` 나 실제 API 호출로 확인한다.

## 자주 쓰는 조회

```sql
-- 프로필 상태 분포
SELECT status, visibility, count(*) FROM profiles GROUP BY 1,2 ORDER BY 1,2;

-- 신청 상태 분포
SELECT status, count(*) FROM match_requests GROUP BY 1;

-- Import 대기 현황
SELECT status, count(*) FROM import_sessions GROUP BY 1;

-- 적용된 마이그레이션
SELECT filename, applied_at FROM schema_migrations ORDER BY filename;

-- RLS 가 켜졌지만 정책이 없는 테이블(있으면 아무도 못 읽는다)
SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname='public' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);

-- 프로필 사진 파일 참조 무결성(깨진 참조 찾기는 셸에서)
SELECT storage_key FROM profile_images;
```

## 하지 말 것

- 개인정보(전화번호·이름·연락처)를 그대로 출력해 대화에 남기지 않는다. 필요하면 마스킹하거나 개수만 센다.
- `var/storage/` 의 사진 파일을 직접 열지 않는다(가드가 막는다).
- 운영 데이터를 UPDATE/DELETE 하기 전에 사용자에게 확인받는다. 조회는 자유.
