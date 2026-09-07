# @bolsaram/domain — 순수 도메인 로직

상태 전이·정보 공개·필터 판정을 담는 **부수효과 없는** 계층. DB·HTTP·파일 시스템을 모르고
`@bolsaram/schemas` 외에는 의존하지 않는다. 그래서 테스트 비용이 가장 싸다.

> **불변식 1: 판정은 여기서만 한다.**
> 어떤 상태 전이가 가능한지, 누구에게 무엇을 보여줄지를 API 라우트나 컴포넌트에서
> 다시 구현하지 않는다. 규칙이 두 곳에 있으면 반드시 어긋난다.
>
> **불변식 2: 부수효과를 들이지 않는다.**
> DB 접근·fetch·파일 IO 를 이 패키지에 넣지 말 것. 저장소 호출이 필요하면 호출부가
> 값을 읽어 넘기고, 여기서는 판정 결과만 돌려준다.
>
> **불변식 3: 위반은 조용히 넘기지 않고 `DomainError` 로 던진다.**
>
> 이 README 는 현재 구조의 소스 오브 트루스다. 파일을 추가·삭제하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../../.ai-harness/project.md) 를 따른다.

---

## 코드 구조

```
packages/domain/src/
├── errors.ts       DomainError + HTTP status 매핑
├── match.ts        소개 신청 상태 기계 (누가·언제·무엇으로)
├── visibility.ts   단계적 정보 공개 (LIST / DETAIL / INTRODUCED / OWNER / ADMIN)
├── import.ts       Import 상태 기계 · 원문 정규화 · 검토 판정 · 게시 게이트
├── filters.ts      Discover 필터 → SQL 조각 · 커서 페이지네이션
└── index.ts        위 전부 재수출
```

---

## 핵심

### `match.ts` — 상태 기계

```
REQUESTED ─accept──► ACCEPTED ─introduce──► INTRODUCED ─close──► CLOSED
    │                    │
    ├─reject──► REJECTED └─close──► CLOSED
    └─cancel──► CANCELED
```

전이는 **상태와 행위자를 함께** 본다. 신청자는 취소만, 대상은 수락·거절만, 연결과 종료는
관리자만 할 수 있다. `resolveTransition()` 이 `{from, to}` 를 돌려주고, 호출부는 그것을
조건부 UPDATE(`WHERE status = from`)에 써서 race condition 을 DB 레벨에서 한 번 더 막는다.

`assertCanCreateRequest()` 가 자기 자신·활성 중복을 막지만 최종 방어선은
`match_requests_one_active` 부분 유니크 인덱스다.

### `visibility.ts` — 정보 공개 단계

| 단계              | 열리는 것                                                            |
| ----------------- | -------------------------------------------------------------------- |
| `LIST`            | 익명 코드, 대표 사진 1장, 출생연도, 키, 직업군, 광역 지역            |
| `DETAIL`          | + 사진 전체, 직업·회사·학력, 종교·MBTI·흡연·음주, 취미, 소개, 이상형 |
| `INTRODUCED`      | + 이름, 연락 방법                                                    |
| `OWNER` / `ADMIN` | 전부                                                                 |

`projectProfile()` 은 걸러낸 필드를 null 로 채우지 않고 **키 자체를 없앤다.** 클라이언트가
"값이 없음"과 "볼 권한 없음"을 구분할 수 있어야 하고, 실수로 직렬화되는 경로를 줄이기 위해서다.

### `import.ts` — 게시 게이트

`assertCommittable(status, fields, { publish })` 가 AI 결과의 자동 게시를 막는다.
확인이 필요한 항목이 남은 상태(`REVIEW_REQUIRED`)에서는 비공개 등록만 되고 공개는 거부된다.
**이 판정은 UI 가 아니라 여기에 있다** — 화면을 우회한 API 호출도 막혀야 하기 때문이다.

`normalizeRawText()` 는 카카오톡 말머리(`[이름] [오후 3:12]`)와 제로폭 문자를 정리한다.
원문 자체는 DB 에 그대로 보관하고, 이 결과는 프롬프트 입력에만 쓴다.

### `filters.ts` — SQL 조각 생성

`buildDiscoverWhere()` 는 값을 **항상 파라미터로만** 넘긴다. 문자열 보간으로 SQL 에 값을
끼워 넣지 않는다. 반환 텍스트는 자리표시자 번호를 `startIndex` 로 이어붙일 수 있다.

나이는 출생연도로 뒤집어 계산한다(`ageMin` 이 클수록 `birthYear` 는 작아진다).

---

## 유지보수

- 규칙을 바꾸면 `tests/` 의 해당 파일에 케이스를 **먼저** 추가한다.
  (`match-transitions` · `visibility` · `filters` · `import-normalization`)
- 상태를 추가하면 `packages/schemas/src/enums.ts` 와 Postgres enum 도 함께 고친다.
- 검증: `pnpm --filter @bolsaram/domain typecheck`,
  `npx vitest run tests/match-transitions.test.ts tests/visibility.test.ts`
