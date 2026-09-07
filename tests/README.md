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
> **불변식 4: 테스트는 외부 모델을 호출하지 않는다.**
> `setup.ts` 가 `AI_PROVIDER=mock` 으로 고정하고 `OPENAI_API_KEY` 를 지운다.
> 개발자 `.env` 가 `openai` 여도 테스트는 유료 API 를 부르지 않는다 —
> 느려지고, 결과가 매번 달라지고, 픽스처가 외부로 나간다.
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
| `telegram-state.test.ts`       | 봇 대화 상태·메시지 분류·원문 우선순위·앨범    | –    | 32   |
| `telegram-import.test.ts`      | webhook 멱등성·계정 연결·사진 묶기·권한 경계   | 필요 | 23   |
| `admin-login.test.ts`          | 관리자 비밀번호 시도 제한·창 만료·권한 경계    | 필요 | 7    |
| `group-isolation.test.ts`      | 모임 간 격리(주선자·회원·Import·신청)          | 필요 | 11   |
| `docs-guide.test.ts`           | 사용자 가이드와 구현의 정합성                  | –    | 21   |
| `docs-readme.test.ts`          | 디렉터리 README 와 코드 구조의 정합성          | –    | 42   |

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
| `telegram-import.test.ts` 「같은 update_id 는 한 번만」    | webhook 재전송이 사진을 두 번 저장하지 않음 |
| `telegram-import.test.ts` 「연결되지 않은 …신원이 없다」   | 검색으로 봇을 찾은 외부인 차단      |
| `telegram-import.test.ts` 「회원 계정으로는 …없다」        | 텔레그램은 주선자 전용 채널         |
| `telegram-import.test.ts` 「같은 앨범이 동시에」           | 앨범 사진의 순서·번호 충돌 없음     |
| `telegram-import.test.ts` 「런타임 롤은 …접근할 수 없다」  | 봇 연결 코드·webhook 이벤트 격리    |
| `telegram-state.test.ts` 「직접 보낸 글이 …우선한다」      | 원문 우선순위(§5.4)                 |
| `admin-login.test.ts` 「실패가 쌓이면 …거절한다」          | 관리자 비밀번호 무한 시도 차단      |
| `admin-login.test.ts` 「창이 지난 실패는 세지 않는다」     | 영구 락아웃 없음(계정 잠그기 방지)  |
| `group-isolation.test.ts` 「남의 모임 …못한다」            | 주선자 자유 가입의 마지막 방어선    |
| `group-isolation.test.ts` 「모임을 넘는 소개 신청」        | 테넌트 경계를 넘는 신청 차단        |
| `docs-guide.test.ts`                                       | 사용자 문서와 구현의 정합성         |
| `docs-readme.test.ts`                                      | 디렉터리 문서와 코드 구조의 정합성  |

## 새 테스트를 쓸 때

- 순수 로직이면 DB 없이 쓴다. 이 계층이 가장 싸고 빠르다.
- DB 가 필요하면 `withOwner` 로 픽스처를 만들고 `withRls` 로 **권한이 걸린 상태**를 검증한다.
  owner 로만 확인하면 정책을 통과하는지 알 수 없다.
- 테스트가 실제로 실패하는지 **일부러 깨뜨려 확인한다.** 통과만 보고 넘어가면
  아무것도 검사하지 않는 테스트가 되기 쉽다.
