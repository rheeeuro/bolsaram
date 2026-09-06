# 볼사람 모바일 Share Import 구현 가이드 v2

## 목표

카카오톡에서 받은 프로필 이미지 여러 장과 글을 사진 앱에 저장하지 않고
볼사람으로 가져온다.

## 먼저 할 실제 기기 Spike

iOS와 Android 각각 다음을 테스트하고 `docs/share-spike-results.md`에
기기/OS/카카오톡 버전과 결과를 기록한다.

-   사진 1장
-   사진 여러 장
-   텍스트
-   사진 + 텍스트
-   공유 취소
-   네트워크 없는 상태

## 공통 모델

``` ts
type IncomingSharePayload = {
  text?: string;
  assets: Array<{
    uri: string;
    mimeType?: string;
    name?: string;
    order: number;
  }>;
};
```

## iOS

Share Extension target에서 `NSExtensionContext` / `NSItemProvider`로
전달 가능한 image/file/text를 읽는다. Extension에서 AI 분석을 오래
기다리지 않는다. payload를 ImportSession에 안전하게 업로드하고 본 앱
또는 review 화면으로 넘긴다. extension의 memory/execution 제한과 임시
파일 lifetime을 고려한다.

## Android

`ACTION_SEND`, `ACTION_SEND_MULTIPLE`, `EXTRA_STREAM`, `EXTRA_TEXT`,
`ClipData`, `content://` URI를 처리한다. content URI를 영구 경로로
가정하지 말고 권한이 있을 때 읽어 업로드한다. 여러 이미지의 순서를
보존한다.

## 업로드

`create Import → signed upload → assets → text → analyze → review → commit`.
대용량 이미지를 Mobile → Next server → Storage로 이중 전송하지 않는다.

## Fallback UX

-   이미지+텍스트: `AI로 프로필 만들기`
-   이미지만: `사진 N장을 가져왔어요` +
    `카카오톡에서 복사한 글 붙여넣기`
-   텍스트만: preview + `사진 추가`
-   실패: 직접 업로드/스크린샷

## 신뢰성

상태:
`RECEIVED → UPLOADING → ANALYZING → REVIEW_REQUIRED|READY → IMPORTED`,
실패는 `FAILED`. 업로드 실패 후 재시도 가능해야 하며 같은 session
commit은 idempotent해야 한다.

## 보안

임시 파일 공개 금지, private storage, 최소 데이터만 AI에 전달, raw
profile/signed URL 로깅 금지, 실제 사용자 사진 fixture 금지.

## 완료 기준

iOS/Android 실제 기기에서 카카오톡 여러 이미지가 하나의
ImportSession으로 들어오고, 텍스트 전달 불가 시 fallback이 작동하며, AI
결과가 관리자 검토 없이 자동 게시되지 않는다.
