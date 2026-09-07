# Share Spike 계획 (설계문서 §15-0, 부트스트랩 §1)

> **이 문서는 계획이다. 실기기 검증은 아직 하지 않았다.**
> 카카오톡이 이미지와 텍스트를 어떻게 넘기는지 코드만으로 확정할 수 없다.
> 결과는 `docs/share-spike-results.md` 에 기기·OS·카카오톡 버전과 함께 기록한다.

## 왜 먼저 하나

볼사람의 최우선 요구사항은 "주선자가 카카오톡에서 받은 프로필 이미지 여러 장과
글을 사진 앱에 저장하지 않고 볼사람으로 바로 가져오는 것"이다. 이게 가능한
경로가 확정되기 전에는 특정 Expo share 라이브러리도, 업로드 방식도 고정하지 않는다.

## 공통 모델

두 플랫폼의 결과를 이 형태로 정규화한다. `packages/schemas/src/import.ts` 의
`incomingSharePayloadSchema` 가 같은 모양이다.

```ts
type IncomingSharePayload = {
  text?: string;
  assets: { uri: string; mimeType?: string; name?: string; order: number }[];
};
```

## 검증 매트릭스

각 칸마다 `전달됨 / 일부 전달 / 전달 안 됨`과 실제 payload 를 기록한다.

| #   | 시나리오      | 확인할 것                                 |
| --- | ------------- | ----------------------------------------- |
| 1   | 사진 1장      | uri 스킴, mimeType 존재 여부              |
| 2   | 사진 여러 장  | 개수 상한, **순서 보존 여부**             |
| 3   | 텍스트만      | 말머리(`[이름] [오후 3:12]`) 포함 여부    |
| 4   | 사진 + 텍스트 | 두 항목이 **한 번의 공유**로 함께 오는지  |
| 5   | 공유 취소     | 세션이 RECEIVED 로 남는지, 정리 필요 여부 |
| 6   | 네트워크 없음 | 업로드 실패 후 재시도로 복구되는지        |
| 7   | 대용량 이미지 | extension 메모리 한도, 리사이즈 필요 여부 |

시나리오 4가 이 프로젝트의 핵심 미지수다. **동시 전달을 가정한 UX 를 먼저 만들지 않는다.**

## iOS

- Share Extension target에서 `NSExtensionContext.inputItems` → `NSItemProvider` 로
  `public.image` / `public.file-url` / `public.plain-text` 를 각각 로드한다.
- 카카오톡이 어떤 UTI 로 넘기는지 확인해야 한다. 이미지가 `public.image` 가 아니라
  파일 URL 로 올 수 있다.
- 임시 파일 lifetime: extension 이 끝나면 접근이 끊길 수 있다. **완료를 호출하기 전에**
  App Group 컨테이너로 복사하거나 업로드를 끝낸다.
- extension 은 메모리/실행 시간 제한이 빡빡하다. AI 분석을 기다리지 않는다 —
  업로드까지만 하고 본 앱의 review 화면으로 deep link 한다.

## Android

- `ACTION_SEND`(단일) 와 `ACTION_SEND_MULTIPLE`(다중)을 모두 처리한다.
- `EXTRA_STREAM`, `EXTRA_TEXT`, `ClipData` 를 모두 읽는다. 카카오톡이 어디에
  넣는지 확인해야 한다.
- `content://` URI 는 영구 경로가 아니다. 권한이 유효한 동안 `ContentResolver` 로
  읽어 업로드한다. 경로를 저장해두고 나중에 쓰지 않는다.
- 다중 이미지의 순서는 `EXTRA_STREAM` 배열 순서를 그대로 `order` 로 쓴다.

## 업로드 순서 (모바일 가이드 「업로드」)

```
POST /api/imports              → 세션 + 에셋별 signed upload 슬롯
PUT  <signed upload url>       → 이미지 직접 업로드 (앱 → 스토리지)
POST /api/imports/:id/assets   → 업로드 확정 등록
PATCH /api/imports/:id/text    → 원문 저장 (없으면 생략)
POST /api/imports/:id/analyze  → AI 분석 (비동기, 결과를 기다리지 않아도 됨)
                               → review 화면 deep link
```

큰 이미지를 `모바일 → Next 서버 → 스토리지` 로 이중 전송하지 않는다.
현재 웹 구현도 같은 계약을 쓰므로 모바일 추가 시 서버 변경이 필요 없다.

## Fallback UX

spike 결과와 무관하게 네 갈래를 모두 구현한다. 웹 Import Inbox 에는 이미 들어가 있다.

| 받은 것         | 화면                                                        |
| --------------- | ----------------------------------------------------------- |
| 이미지 + 텍스트 | `AI로 프로필 만들기` 바로 실행                              |
| 이미지만        | `사진 N장을 가져왔어요` + `카카오톡에서 복사한 글 붙여넣기` |
| 텍스트만        | 원문 preview + `사진 추가`                                  |
| 실패            | 직접 업로드 / 스크린샷                                      |

## 판단 기준

- 시나리오 4가 **동작하면**: 공유 한 번으로 Import 완료 UX 를 기본으로 한다.
- 시나리오 4가 **동작하지 않으면**: 이미지 공유를 기본 경로로 두고 텍스트 붙여넣기를
  같은 화면에 1급 시민으로 배치한다. 두 번 공유하라고 요구하지 않는다.
- 시나리오 2의 순서가 **보존되지 않으면**: 사용자가 review 화면에서 대표 사진을
  고르게 한다(현재 Admin Import 상세에 이미 있음).

## 라이브러리 선택은 이 뒤에

Expo SDK 버전에 맞춰 검증 가능한 방법을 그때 고른다. 필요하면 prebuild 후
Swift/Kotlin 코드를 직접 넣는다.
