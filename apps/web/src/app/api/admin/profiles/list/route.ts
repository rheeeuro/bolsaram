/**
 * GET /api/admin/profiles/list — 주선자 프로필 목록의 다음 페이지.
 *
 * 첫 페이지는 화면(`/profiles`)이 서버에서 그린다. 스크롤이 끝에 닿으면 같은 조건과
 * `cursor` 로 여기를 불러 이어 붙인다. 조회와 공개 단계는 화면과 같은 함수가 정한다.
 */
import { adminProfileQuerySchema } from "@bolsaram/schemas";
import { asAdmin } from "@/server/http/context";
import { ok, readQuery, route } from "@/server/http/respond";
import { loadHostProfilePage } from "@/server/views/host-profile-list";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const query = readQuery(request, adminProfileQuerySchema);
  // 보기 모드는 조건이 아니라 화면의 것이다. 이상한 값은 카드로 떨어뜨린다 — 화면과 같다.
  const mode = new URL(request.url).searchParams.get("view") === "raw" ? "raw" : "card";
  const page = await asAdmin((sql, viewer) => loadHostProfilePage(sql, viewer, query, mode));
  return ok(page);
});
