/**
 * GET /api/profiles — Discover 리스트 (설계문서 §10).
 * `view=raw` 이면 「원본으로 보기」 줄 — 사진 전체와 정리된 줄글을 함께 싣는다.
 */
import { discoverQuerySchema } from "@bolsaram/schemas";
import { asUser } from "@/server/http/context";
import { ok, readQuery, route } from "@/server/http/respond";
import { favoriteSet } from "@/server/repo/favorites";
import { findDiscoverProfiles } from "@/server/repo/profiles";
import { recommendedIdsFor } from "@/server/services/recommend-service";
import { toCardView, toRawView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const query = readQuery(request, discoverQuerySchema);
  // 보기 방식은 조건이 아니라 화면의 것이라 조회 스키마에 넣지 않는다. 모르는 값은 카드다.
  const toView = new URL(request.url).searchParams.get("view") === "raw" ? toRawView : toCardView;
  return asUser(async (sql, viewer) => {
    // 저장된 이상형 조건끼리 견주기만 한다 — AI 를 부르지 않는다.
    const recommended = await recommendedIdsFor(sql, viewer.profileId);
    const page = await findDiscoverProfiles(
      sql,
      query,
      viewer.profileId,
      query.ai ? { onlyIds: [...recommended] } : {},
    );
    const favorites = await favoriteSet(
      sql,
      viewer.userId,
      page.items.map((p) => p.id),
    );
    return ok({
      items: page.items.map((p) =>
        toView(p, { isFavorited: favorites.has(p.id), aiRecommended: recommended.has(p.id) }),
      ),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
});
