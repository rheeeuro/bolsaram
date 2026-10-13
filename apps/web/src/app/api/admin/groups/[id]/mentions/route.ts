/**
 * 채팅 태그 후보 — `@` 뒤에 친 번호 앞자리로 이 모임의 멤버를 찾는다.
 *
 *   GET  ?q=23
 *
 * 입력란 위에 뜨는 목록이 부른다. 번호·성별·나이·직업·사진만 주고 이름은 주지 않는다.
 * 소속은 `requireGroupAdmin` 이, 볼 수 있는 프로필은 RLS 가 다시 판정한다.
 */
import { withRls } from "@bolsaram/db";
import { GROUP_MENTION_LIMIT, groupMentionQuerySchema } from "@bolsaram/schemas";
import { requireGroupAdmin, rlsContextOf } from "@/server/auth/guard";
import { listMentionCandidates } from "@/server/repo/group-chat";
import { imageUrlFor } from "@/server/views/image-url";
import { ok, readQuery, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const query = readQuery(request, groupMentionQuerySchema);
  const viewer = await requireGroupAdmin(id);
  const candidates = await withRls(rlsContextOf(viewer), (sql) =>
    listMentionCandidates(sql, id, query.q, GROUP_MENTION_LIMIT),
  );
  return ok({
    candidates: candidates.map(({ photoKey, ...candidate }) => ({
      ...candidate,
      photoUrl: imageUrlFor(photoKey),
    })),
  });
});
