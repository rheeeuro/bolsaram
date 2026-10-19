/**
 * 모임 채팅 메시지를 화면으로 내보내는 모양.
 *
 * 저장소는 작성자 사진의 **저장 키**를 준다. 화면에는 키 대신 단기 signed URL 을 싣는다 —
 * 첫 화면·이전 글·새 글·스트림이 모두 여기를 지나므로 사진 규칙이 한 곳에 있다.
 */
import "server-only";
import type { GroupMessageRecord } from "../repo/group-chat";
import { imageUrlFor } from "./image-url";

export type GroupMessageView = Omit<GroupMessageRecord, "authorAvatarKey"> & {
  /** 작성자 프로필 사진. 없으면 화면이 이름의 앞글자를 그린다. */
  authorAvatarUrl: string | null;
};

export function toMessageView({
  authorAvatarKey,
  ...message
}: GroupMessageRecord): GroupMessageView {
  return { ...message, authorAvatarUrl: imageUrlFor(authorAvatarKey) };
}
