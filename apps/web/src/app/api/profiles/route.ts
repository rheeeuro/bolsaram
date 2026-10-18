/** GET /api/profiles — Discover 리스트 (설계문서 §10) */
import { discoverQuerySchema } from "@bolsaram/schemas";
import { asUser } from "@/server/http/context";
import { ok, readQuery, route } from "@/server/http/respond";
import { favoriteSet } from "@/server/repo/favorites";
import { findDiscoverProfiles } from "@/server/repo/profiles";
import { recommendedIdsFor } from "@/server/services/recommend-service";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const query = readQuery(request, discoverQuerySchema);
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
        toCardView(p, { isFavorited: favorites.has(p.id), aiRecommended: recommended.has(p.id) }),
      ),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
});
