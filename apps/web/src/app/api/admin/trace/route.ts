/**
 * GET /api/admin/trace?host=8f3a2c — 워터마크의 주선자 코드가 누구인가
 *
 * 캡처본 확인 화면에서 `H-8F3A2C` 를 읽었을 때 부른다. 사진은 받지 않는다 — 판독은
 * 브라우저 안에서 끝나고, 여기는 읽어 낸 코드만 받는다.
 * 찾을 수 있는 범위는 나 자신과 같은 모임 동료다(RLS). 그 밖이면 빈 목록이다.
 */
import { z } from "zod";
import { asAdmin } from "@/server/http/context";
import { ok, readQuery, route } from "@/server/http/respond";
import { findHostsByCode } from "@/server/repo/users";

export const dynamic = "force-dynamic";

const querySchema = z.object({ host: z.string().regex(/^[0-9a-fA-F]{6}$/) });

export const GET = route(async (request: Request) => {
  const { host } = readQuery(request, querySchema);
  return asAdmin(async (sql, viewer) => {
    const hosts = await findHostsByCode(sql, host);
    return ok({
      hosts: hosts.map((h) => ({ displayName: h.displayName, isSelf: h.userId === viewer.userId })),
    });
  });
});
