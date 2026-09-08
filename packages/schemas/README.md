# @bolsaram/schemas — 스키마와 도메인 열거형

Zod 스키마와 도메인 열거형의 **단일 원본**. 웹 앱·도메인 로직·DB·AI 프롬프트가 모두 여기서
타입과 값을 가져간다. 런타임 의존성은 `zod` 하나뿐이고 Node·브라우저 어디서나 import 된다.

> **불변식 1: AI 추출 스키마는 `src/extraction.ts` 가 유일한 소스다.**
> 모델에 보내는 JSON Schema, 응답 검증, 관리자 검토 화면의 필드 목록이 전부 여기서 파생된다.
> 프롬프트나 검증을 따로 손대지 말고 이 파일을 고친다.
>
> **불변식 2: enum 값은 Postgres enum 과 1:1 이다.**
> `src/enums.ts` 를 고치면 `db/migrations/` 에 대응하는 마이그레이션을 **함께** 추가한다.
> 한쪽만 바꾸면 런타임에 깨진다(값 불일치는 타입 검사로 잡히지 않는다).
>
> 이 README 는 현재 구조의 소스 오브 트루스다. 파일을 추가·삭제하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../../.ai-harness/project.md) 를 따른다.

---

## 코드 구조

```
packages/schemas/src/
├── enums.ts        도메인 열거형 + 한글 라벨 (성별·지역·직업군·종교·흡연·음주·상태 등)
├── extraction.ts   AI 추출 스키마 · strict JSON Schema 생성 · 신뢰도 기준
├── profile.ts      프로필 읽기/쓰기 · 등록 동의 기록 · Discover 필터 · 관리자 목록 쿼리
├── match.ts        소개 신청 생성·거절·연결, 관심 토글
├── import.ts       Import 세션·에셋·원문·검토·commit
├── auth.ts         전화번호 정규화, 주선자 로그인, 초대 링크·모임 코드
├── telegram.ts     텔레그램 Bot API payload · 파일/사진 상한
└── index.ts        위 전부 재수출
```

---

## 핵심

### `enums.ts` — 값과 라벨을 함께 둔다

각 열거형은 `as const` 배열 + `Record<T, string>` 라벨 쌍으로 정의한다.
UI 는 라벨 맵을 직접 인덱싱하지 않고 `apps/web/src/lib/labels.ts` 를 거친다.

`DISCOVERABLE_PROFILE_STATUSES` 와 `ACTIVE_MATCH_REQUEST_STATUSES` 는 "어떤 상태가
목록에 보이는가 / 어떤 상태가 중복을 막는가"를 값으로 고정한 것이다. 조건문에 상태를
직접 나열하지 말고 이 배열을 쓴다.

### `extraction.ts` — 모델용과 검증용을 분리

같은 필드 목록에서 두 가지를 만든다.

| 용도      | 정의                     | 이유                                                                                             |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| 모델 요청 | `toStrictJsonSchema()`   | OpenAI strict 모드는 전 필드 required · `additionalProperties:false` · `default` 금지를 요구한다 |
| 응답 검증 | `extractionResultSchema` | 사람이 일부만 고친 결과도 통과해야 하므로 confidence 를 `partialRecord` 로 둔다                  |

- 모든 필드가 nullable 이다. 모델이 모르면 **추론하지 않고 null** 을 넣는다.
- `REQUIRED_FIELDS_FOR_COMMIT` 가 비어 있으면 프로필로 등록할 수 없다.
- `LOW_CONFIDENCE_THRESHOLD` 미만이면 관리자 검토 화면에서 강조된다.

### `telegram.ts` — 외부에서 들어오는 입력

webhook 본문은 신뢰할 수 없는 입력이다. AI raw 출력과 같은 규칙을 적용해 **반드시
validate 한 뒤에만** 쓴다. 우리가 실제로 읽는 필드만 선언하므로 텔레그램이 필드를
추가해도 깨지지 않는다(Zod 가 선언하지 않은 키를 조용히 버린다).

`TELEGRAM_MAX_FILE_BYTES` 는 20MB 다 — Bot API 의 `getFile` 제약이며 우리 업로드
상한(25MB)보다 작다. 어떤 메시지를 무엇으로 해석할지는 여기가 아니라
`@bolsaram/domain` 의 `classifyTelegramMessage` 가 정한다.

### `profile.ts` — 쿼리스트링을 다루는 스키마

`discoverQuerySchema` 는 URL 에서 오므로 문자열을 강제 변환한다. 쉼표 목록(`regions=SEOUL,BUSAN`)과
배열 형태를 모두 받아 배열로 정규화한다. 자유 검색(`q`)은 공개 범위 안의 텍스트만 훑는다 —
이름·연락처는 검색 대상이 아니다.

---

## 쓰는 곳

| 소비자                      | 무엇을                    |
| --------------------------- | ------------------------- |
| `apps/web/src/app/api/*`    | 요청 본문·쿼리 검증       |
| `apps/web/src/server/ai/*`  | 추출 스키마와 JSON Schema |
| `packages/domain/*`         | 상태·필드 타입            |
| `apps/web/src/components/*` | 열거형 값과 라벨          |

## 유지보수

- 필드를 추가하면 스키마 → 마이그레이션 → 도메인 → UI 순으로 따라간다.
- 열거형을 바꾸면 `pnpm db:migrate` 로 적용하고 `npx vitest run tests/rls.test.ts` 를 돌린다.
- 검증: `pnpm --filter @bolsaram/schemas typecheck`, `npx vitest run tests/extraction.test.ts`
