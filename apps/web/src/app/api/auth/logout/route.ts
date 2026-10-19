import { destroySession } from "@/server/auth/session";
import { ok, route } from "@/server/http/respond";

export const POST = route(async () => {
  await destroySession();
  // 사진은 보는 사람의 브라우저에 잠깐 캐시된다(`/api/files`). 공용 기기에 남지 않게 비운다.
  return ok({ ok: true }, { headers: { "clear-site-data": '"cache"' } });
});
