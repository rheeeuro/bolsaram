import { requestOtpSchema } from "@bolsaram/schemas";
import { issueLoginCode } from "@/server/auth/login";
import { ok, readJson, route } from "@/server/http/respond";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, requestOtpSchema);
  const result = await issueLoginCode(input.phone);
  // devCode 는 DEV_EXPOSE_OTP=true 일 때만 채워진다.
  return ok({ ok: true, ...result });
});
