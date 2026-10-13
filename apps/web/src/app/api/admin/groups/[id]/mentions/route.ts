/**
 * 채팅 멘션 후보. 입력란 위에 뜨는 목록이 부른다.
 *
 *   GET  ?kind=host&q=김     `@` — 이 모임 주선자 (나는 빼고)
 *   GET  ?kind=member&q=23   `#` — 이 모임 멤버. 번호·성별·나이·직업·사진만, 이름은 없다
 *
 * 소속은 `requireGroupAdmin` 이, 볼 수 있는 명단과 프로필은 RLS 가 다시 판정한다.
 */
import { withRls } from "@bolsaram/db";
import { GROUP_MENTION_LIMIT, groupMentionQuerySchema } from "@bolsaram/schemas";
import { requireGroupAdmin, rlsContextOf } from "@/server/auth/guard";
import { listHostMentionCandidates, listMentionCandidates } from "@/server/repo/group-chat";
import { imageUrlFor } from "@/server/views/image-url";
import { ok, readQuery, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const query = readQuery(request, groupMentionQuerySchema);
  const viewer = await requireGroupAdmin(id);
  if (query.kind === "host") {
    const hosts = await withRls(rlsContextOf(viewer), (sql) =>
      listHostMentionCandidates(sql, id, viewer.userId, query.q, GROUP_MENTION_LIMIT),
    );
    return ok({
      hosts: hosts.map(({ avatarKey, ...host }) => ({ ...host, avatarUrl: imageUrlFor(avatarKey) })),
    });
  }
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
