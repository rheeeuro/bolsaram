/**
 * private 스토리지 다운로드. signed URL 로만 접근할 수 있다.
 *
 * 서명 검증에 더해 로그인도 요구한다 — 서명 URL 이 유출되어도 외부인이 쓸 수 없게 한다.
 * 서명 URL 은 짧게 만료되며 캐시를 금지한다.
 */
import { NextResponse } from "next/server";
import { readSession } from "@/server/auth/session";
import { fail, route } from "@/server/http/respond";
import { objectSize, openObject, verifySignature } from "@/server/storage/local";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const user = await readSession();
  if (!user) return fail("FORBIDDEN", "로그인이 필요합니다.", 401);

  const params = new URL(request.url).searchParams;
  const key = params.get("key");
  const exp = params.get("exp");
  const sig = params.get("sig");
  if (!key || !exp || !sig) return fail("VALIDATION", "잘못된 요청입니다.", 400);

  const verified = verifySignature("download", key, exp, sig);
  if (!verified.ok) {
    return verified.reason === "expired"
      ? fail("FORBIDDEN", "링크가 만료되었습니다.", 410)
      : fail("FORBIDDEN", "잘못된 링크입니다.", 403);
  }

  const size = await objectSize(key);
  if (size == null) return fail("NOT_FOUND", "파일을 찾을 수 없습니다.", 404);

  const contentType = contentTypeFor(key);
  const stream = Readable.toWeb(openObject(key) as Readable) as WebReadableStream<Uint8Array>;
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "content-type": contentType,
      "content-length": String(size),
      // 서명 URL 이 캐시에 남지 않게 한다.
      "cache-control": "private, no-store",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      // SVG 는 스크립트를 담을 수 있다. 업로드로는 받지 않지만(local.ts 의 허용 목록 참고)
      // 시드가 만든 자리표시 이미지가 SVG 이므로 서빙 시 샌드박스로 무력화한다.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".svg":
      // 시드 자리표시 이미지 전용. 위 CSP 로 스크립트 실행을 막는다.
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
