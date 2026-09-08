/**
 * 숨기기 토글 (마이그레이션 0023).
 *
 * 관심(`/api/favorites`)과 달리 `asMember` 를 쓴다 — 숨김은 프로필 사이의 관계이므로
 * 본인 프로필이 연결된 회원만 만들 수 있다.
 *
 * 응답에 상대의 숨김 여부를 싣지 않는다. 내가 숨긴 것만 알려주면 되고, 상대가 나를
 * 숨겼는지까지 돌려주면 숨기기가 통보가 된다.
 */
import { DomainError, assertCanHide, isDetailAccessible } from "@bolsaram/domain";
import { profileHideSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asMember } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { addHide, hiddenProfileIds, removeHide } from "@/server/repo/hides";
import { findActiveBetween } from "@/server/repo/matches";
import { findProfileById, findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  asMember(async (sql, viewer) => {
    const ids = await hiddenProfileIds(sql, viewer.profileId);
    const profiles = await findProfilesByIds(sql, ids);
    const byId = new Map(profiles.map((p) => [p.id, p]));
    // 숨긴 순서를 유지한다. RLS 로 걸러진 프로필은 자연스럽게 빠진다.
    const items = ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => toCardView(p));
    return ok({ items });
  }),
);

export const POST = route(async (request: Request) => {
  const input = await readJson(request, profileHideSchema);
  return asMember(async (sql, viewer) => {
    // 대상이 실제로 열람 가능한 프로필인지 먼저 본다. 없는 id 를 그대로 넣으면 FK
    // 위반이 500 으로 새고, 200/500 의 차이가 「그 프로필이 있는가」를 알려준다.
    const target = await findProfileById(sql, input.profileId);
    if (!target || !isDetailAccessible(target)) {
      throw new DomainError("NOT_FOUND", "그 프로필을 찾을 수 없습니다.");
    }

    const existing = await findActiveBetween(sql, viewer.profileId, input.profileId);
    assertCanHide({
      hiderProfileId: viewer.profileId,
      hiddenProfileId: input.profileId,
      existingActiveStatus: existing?.status ?? null,
    });

    await addHide(sql, viewer.profileId, input.profileId);
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.hide",
      entityType: "profile",
      entityId: input.profileId,
    });
    return ok({ ok: true, hidden: true });
  });
});

export const DELETE = route(async (request: Request) => {
  const input = await readJson(request, profileHideSchema);
  return asMember(async (sql, viewer) => {
    await removeHide(sql, viewer.profileId, input.profileId);
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.unhide",
      entityType: "profile",
      entityId: input.profileId,
    });
    return ok({ ok: true, hidden: false });
  });
});
