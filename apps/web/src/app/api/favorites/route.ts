/** 관심 저장 토글 (설계문서 §10) */
import { favoriteToggleSchema } from "@bolsaram/schemas";
import { asUser } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { addFavorite, favoriteProfileIds, removeFavorite } from "@/server/repo/favorites";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  asUser(async (sql, viewer) => {
    const ids = await favoriteProfileIds(sql, viewer.userId);
    const profiles = await findProfilesByIds(sql, ids);
    // 저장 순서를 유지한다.
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => toCardView(p, { isFavorited: true }));
    return ok({ items });
  }),
);

export const POST = route(async (request: Request) => {
  const input = await readJson(request, favoriteToggleSchema);
  return asUser(async (sql, viewer) => {
    await addFavorite(sql, viewer.userId, input.profileId);
    return ok({ ok: true, favorited: true });
  });
});

export const DELETE = route(async (request: Request) => {
  const input = await readJson(request, favoriteToggleSchema);
  return asUser(async (sql, viewer) => {
    await removeFavorite(sql, viewer.userId, input.profileId);
    return ok({ ok: true, favorited: false });
  });
});
