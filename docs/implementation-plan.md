# 볼사람 v2 구현 계획

`docs/v2/BOLSARAM_SERVICE_DESIGN_v2.md`, `BOLSARAM_MOBILE_SHARE_IMPORT_GUIDE_v2.md`,
`BOLSARAM_CODEX_BOOTSTRAP_PROMPT_v2.md` 를 기준으로 한 실행 계획이다.

## 설계 문서와 달라진 결정

설계 문서는 Supabase(PostgreSQL/Auth/Storage/RLS)를 전제하지만, 이 저장소의 고정
인프라는 로컬 컨테이너다. 사용자 확인을 거쳐 다음과 같이 대체했다.

| 설계 문서           | 이 구현                                                                          | 이유                                                                                |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Supabase PostgreSQL | 로컬 `postgres:17` (`127.0.0.1:5442`)                                            | 외부 계정·키 없이 전체 플로우를 실제로 돌려 검증하기 위해                           |
| Supabase Auth       | 자체 세션(서명 쿠키 + `sessions` 테이블), 관리자 이메일/비밀번호 · 회원 전화 OTP | 동일                                                                                |
| Supabase Storage    | 로컬 private 디렉터리 + HMAC signed URL                                          | 동일                                                                                |
| Supabase RLS        | Postgres RLS 그대로 사용                                                         | 대체하지 않았다. `bolsaram_app` 롤은 `NOBYPASSRLS` 이며 모든 접근이 정책을 통과한다 |
| OpenAI multimodal   | provider 추상화, 기본 `mock`                                                     | `OPENAI_API_KEY` 가 있으면 `AI_PROVIDER=openai` 로 전환                             |
| Expo 모바일 앱      | 이번 범위 제외. spike 계획 문서 + 웹 Import 우선                                 | 실기기 검증 없이 share 동작을 확정할 수 없다(설계문서 §15-0)                        |

기존 MariaDB(`3308`)는 v1 프로토타입용이며 `docker compose --profile legacy` 로만 뜬다.
백엔드 포트 `8010` 은 쓰지 않는다 — API 가 Next.js Route Handler 로 웹 앱(`3020`) 안에 있다.

## 단계

| 단계 | 내용                                                                         | 상태                           |
| ---- | ---------------------------------------------------------------------------- | ------------------------------ |
| 0    | Share Spike 계획 문서                                                        | 완료(문서), 실기기 검증 미실시 |
| 1    | Foundation: pnpm workspace, TS strict, lint/test, 디자인 토큰                | 완료                           |
| 2    | Schema: 마이그레이션 · 인덱스 · 제약 · RLS · synthetic seed                  | 완료                           |
| 3    | Auth/Roles: 세션, 서버 권한 검증, admin route guard                          | 완료                           |
| 4    | Storage: private 저장소 + 단기 signed URL                                    | 완료                           |
| 5    | Member UI: Discover / 필터 / 상세 / 관심 / 시그널 / 내 프로필                | 완료                           |
| 6    | Match domain: 상태 전이 중앙화, 자기 자신·중복·race 차단                     | 완료                           |
| 7    | Admin: 대시보드 / 프로필 / 신청 / 회원 / Import Inbox                        | 완료                           |
| 8    | Import API: 세션 · 다중 에셋 업로드 · 원문 · 분석 · 검토 · idempotent commit | 완료                           |
| 9    | AI extraction: Zod single source, 추측 금지, confidence, mock 가능           | 완료                           |
| 10   | Mobile Share                                                                 | 미착수(범위 제외)              |
| 11   | Invite/Claim: 만료·해시 토큰, replay 방지                                    | 완료                           |
| 12   | Tests: 필터 · 상태 전이 · 권한 · 정규화 · 검증 · idempotency                 | 완료 (101개)                   |

## 실기기에서 따로 확인해야 하는 항목

`docs/share-spike-plan.md` 참고. 코드만으로 확정할 수 없다.

## 검증 상태

`pnpm verify` (typecheck + lint + test) 통과. 테스트 101개:

| 파일                                 | 내용                                                    | 개수 |
| ------------------------------------ | ------------------------------------------------------- | ---- |
| `tests/match-transitions.test.ts`    | 상태 기계 · 행위자 권한 · 중복/자기 자신 차단           | 11   |
| `tests/visibility.test.ts`           | 단계적 정보 공개 · 노출 규칙                            | 10   |
| `tests/filters.test.ts`              | 필터 → SQL · 파라미터 바인딩 · 커서                     | 12   |
| `tests/import-normalization.test.ts` | 원문 정규화 · Import 상태 기계 · commit 게이트          | 23   |
| `tests/extraction.test.ts`           | 추출 스키마 검증 · strict JSON Schema · mock 프로바이더 | 15   |
| `tests/rls.test.ts`                  | 실제 DB 에 대한 RLS 정책 강제                           | 22   |
| `tests/import-commit.test.ts`        | 분석 · commit 멱등성 · 동시 호출                        | 8    |

수동으로 확인한 것(로컬 서버, 실제 DB):

- 미인증 요청은 API 401, 페이지는 `/login` 리다이렉트. 회원의 `/admin` 접근은 `/discover` 리다이렉트.
- 관리자/회원 로그인, OTP 오입력·재발송 제한.
- Discover 필터 전 항목, 한국어 자유 검색.
- `신청 → 수락 → 연결` 전 구간과 각 단계의 정보 공개 범위. 제3자에게는 끝까지 비공개.
- Import: 세션 생성 → signed upload(미인증 401 / 서명 위조 403) → mock 추출 → 검토 → commit.
- 같은 세션 commit 2회 호출 시 동일 프로필 반환(`reused: true`).
- 검토가 남은 상태에서 공개 commit 거부.
- 초대 발급 → claim → 재사용 거부. 평문 토큰은 DB에 없음.
- signed URL: 유효 200 / 비로그인 401 / 변조 403 / 만료 410 / 경로 탈출 403, `cache-control: private, no-store`.

브라우저 스크린샷은 찍지 못했습니다 — 이 호스트에 Chromium 실행에 필요한 시스템 라이브러리(`libatk-1.0`)가
없습니다. 대신 각 화면의 렌더링된 HTML에서 핵심 요소를 확인했습니다.
