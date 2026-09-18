/**
 * 저장 키를 화면이 쓸 수 있는 주소로 바꾼다.
 *
 * 프로필 사진(`profile-view.ts`)과 같은 규칙이다 — 영구 URL 을 만들지 않고 응답마다
 * 단기 signed URL 을 새로 발급한다. 키가 없으면 `null` 이고, 그때 화면은 이름의
 * 앞글자를 그린다(`components/ui/avatar.tsx`).
 *
 * 주선자 프로필 사진과 모임 사진처럼 **행 하나에 사진 하나**인 곳이 쓴다.
 */
import "server-only";
import { signDownloadUrl } from "../storage/local";

export function imageUrlFor(storageKey: string | null | undefined): string | null {
  return storageKey ? signDownloadUrl(storageKey) : null;
}
