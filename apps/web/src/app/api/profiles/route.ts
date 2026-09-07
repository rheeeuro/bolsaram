/** GET /api/profiles — Discover 리스트 (설계문서 §10) */
import { discoverQuerySchema } from "@bolsaram/schemas";
import { asUser } from "@/server/http/context";
import { ok, readQuery, route } from "@/server/http/respond";
import { favoriteSet } from "@/server/repo/favorites";
import { findDiscoverProfiles } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const query = readQuery(request, discoverQuerySchema);
  return asUser(async (sql, viewer) => {
    const page = await findDiscoverProfiles(sql, query, viewer.profileId);
    const favorites = await favoriteSet(
      sql,
      viewer.userId,
      page.items.map((p) => p.id),
    );
    return ok({
      items: page.items.map((p) => toCardView(p, { isFavorited: favorites.has(p.id) })),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  });
});
