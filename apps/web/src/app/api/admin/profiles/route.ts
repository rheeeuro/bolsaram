/**
 * GET /api/admin/profiles — 주선자 목록 조건에 맞는 사람 수.
 *
 * 조건 설정 시트가 고르는 동안 「N명 보기」를 미리 보여주려고 부른다. 목록 자체는
 * 화면(`/profiles`)이 서버에서 그리므로 여기서는 숫자만 준다. 범위는 목록과 같다 —
 * 지금 보고 있는 모임 안이고, 볼 수 있는지는 RLS 가 정한다.
 */
import { adminProfileQuerySchema } from "@bolsaram/schemas";
import { asAdmin } from "@/server/http/context";
import { ok, readQuery, route } from "@/server/http/respond";
import { countAdminProfiles } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const query = readQuery(request, adminProfileQuerySchema);
  const total = await asAdmin((sql, viewer) =>
    countAdminProfiles(sql, query, { groupId: viewer.groupId }),
  );
  return ok({ total });
});
