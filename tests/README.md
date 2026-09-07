# tests — 검증

vitest. 순수 도메인 단위 테스트와 **실제 Postgres 에 붙는 통합 테스트**가 섞여 있다.
DB 통합 테스트가 있으므로 `pnpm db:up` 이 필요하다.

> **불변식 1: "안 되는 것"을 테스트한다.**
> 이 서비스는 비공개 소개팅이라 "동작하는가"보다 **"권한 없는 사람이 못 보는가"** 가 중요하다.
> 정책을 추가하면 통과 케이스보다 차단 케이스를 먼저 쓴다.
>
> **불변식 2: 실제 인물 정보를 fixture 로 쓰지 않는다.** 전부 합성 데이터다.
>
> **불변식 3: 통합 테스트는 자기가 만든 것만 지운다.**
> 태그(`TAG`)로 자기 데이터를 표시하고 `afterAll` 에서 그것만 정리한다. 시드를 건드리지 않는다.
>
> 이 README 는 현재 구성의 소스 오브 트루스다. 파일을 추가하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../.ai-harness/project.md) 를 따른다.

---

## 구성

| 파일                           | 대상                                           | DB   | 개수 |
| ------------------------------ | ---------------------------------------------- | ---- | ---- |
| `match-transitions.test.ts`    | 상태 기계·행위자 권한·중복·자기 자신           | –    | 11   |
| `visibility.test.ts`           | 단계적 정보 공개·노출 규칙                     | –    | 10   |
| `filters.test.ts`              | 필터 → SQL·파라미터 바인딩·커서                | –    | 12   |
| `import-normalization.test.ts` | 원문 정규화·Import 상태 기계·게시 게이트       | –    | 23   |
| `extraction.test.ts`           | 추출 스키마·strict JSON Schema·mock 프로바이더 | –    | 15   |
| `rls.test.ts`                  | RLS 정책 강제                                  | 필요 | 22   |
| `import-commit.test.ts`        | 분석·commit 멱등성·동시 호출                   | 필요 | 8    |
| `cleanup.test.ts`              | 만료 정리·참조된 사진 보존·경로 탈출           | 필요 | 7    |
| `docs-guide.test.ts`           | 사용자 가이드와 구현의 정합성                  | –    | 21   |
| `docs-readme.test.ts`          | 디렉터리 README 와 코드 구조의 정합성          | –    | 35   |

`setup.ts` 가 리포 루트 `.env` 를 읽어 DB 접속 정보를 채운다.
`stubs/server-only.ts` 는 `server-only` 표식을 Node 러너에서 무력화한다.

## 실행

```bash
pnpm test                                  # 전체
npx vitest run tests/rls.test.ts           # 하나만
npx vitest                                 # watch
```

DB 를 공유하므로 파일 간 병렬 실행을 끄고(`fileParallelism: false`) 순차로 돈다.

## 무엇을 지키는 테스트인가

바꾸기 전에 왜 있는지 알아야 하는 것들이다.

| 테스트                                                     | 지키는 성질                         |
| ---------------------------------------------------------- | ----------------------------------- |
| `rls.test.ts` 「익명은 아무 프로필도 보지 못한다」         | 로그인 없이 열람 불가 (DB 레벨)     |
| `rls.test.ts` 「남의 명의로 신청할 수 없다」               | 신청 사칭 차단                      |
| `rls.test.ts` 「GUC 가 남지 않는다」                       | 커넥션 재사용 시 권한 유출 없음     |
| `visibility.test.ts` 「INTRODUCED 에서만 이름·연락처」     | 연결 전 개인정보 비공개             |
| `import-normalization.test.ts` 「확인이 남으면 공개 불가」 | AI 자동 게시 차단                   |
| `import-commit.test.ts` 「동시 호출에도 프로필 하나」      | commit 멱등성                       |
| `cleanup.test.ts` 「참조된 사진은 남긴다」                 | 정리 작업이 게시된 사진을 깨지 않음 |
| `docs-guide.test.ts`                                       | 사용자 문서와 구현의 정합성         |
| `docs-readme.test.ts`                                      | 디렉터리 문서와 코드 구조의 정합성  |

## 새 테스트를 쓸 때

- 순수 로직이면 DB 없이 쓴다. 이 계층이 가장 싸고 빠르다.
- DB 가 필요하면 `withOwner` 로 픽스처를 만들고 `withRls` 로 **권한이 걸린 상태**를 검증한다.
  owner 로만 확인하면 정책을 통과하는지 알 수 없다.
- 테스트가 실제로 실패하는지 **일부러 깨뜨려 확인한다.** 통과만 보고 넘어가면
  아무것도 검사하지 않는 테스트가 되기 쉽다.
