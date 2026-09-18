/**
 * PATCH /api/admin/me — 내 표시 이름 바꾸기
 *
 * 소셜 제공자가 준 이름은 계정을 처음 만들 때 한 번만 쓴다. 그 뒤로 이 이름을 정하는
 * 것은 본인이다(`server/auth/oauth.ts` 의 `loginWithOAuth` 가 기존 이름을 덮지 않는다).
 *
 * 이름이 보이는 곳은 상단의 「○○ 님」, 모임 설정의 주선자 목록, 모임 채팅의 작성자다.
 * 멤버에게는 보이지 않는다 — 멤버와 주선자가 만나는 자리에는 이름이 나오지 않는다.
 */
import { displayNameUpdateSchema } from "@bolsaram/schemas";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { updateDisplayName } from "@/server/repo/users";

export const dynamic = "force-dynamic";

export const PATCH = route(async (request: Request) => {
  const input = await readJson(request, displayNameUpdateSchema);
  return asAdmin(async (sql, viewer) => {
    await updateDisplayName(sql, viewer.userId, input.displayName);
    return ok({ displayName: input.displayName });
  });
});
