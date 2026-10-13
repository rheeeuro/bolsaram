/**
 * private 스토리지 다운로드. signed URL 로만 접근할 수 있다.
 *
 * 서명 검증에 더해 로그인도 요구한다 — 서명 URL 이 유출되어도 외부인이 쓸 수 없게 한다.
 * 서명 URL 은 짧게 만료되며 캐시를 금지한다.
 *
 * 프로필 사진에는 보는 사람 표시를 합성해 내보낸다(`server/storage/watermark.ts`) —
 * 주선자는 전부, 멤버는 자기 사진을 뺀 전부.
 */
import { NextResponse } from "next/server";
import { withRls } from "@bolsaram/db";
import { rlsContextOf } from "@/server/auth/guard";
import { readSession } from "@/server/auth/session";
import { fail, route } from "@/server/http/respond";
import { findImageProfileId } from "@/server/repo/profile-images";
import { findPublicCode } from "@/server/repo/profiles";
import {
  isHostOnlyKey,
  objectSize,
  openObject,
  verifySignature,
} from "@/server/storage/local";
import { viewerMark, watermarkImage } from "@/server/storage/watermark";
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

  // 멤버가 여는 프로필 사진이면 어느 프로필 것인지와 보는 사람의 공개 번호를 함께 읽는다.
  const member =
    user.role !== "ADMIN" && isProfilePhotoKey(key)
      ? await withRls(rlsContextOf(user), async (sql) => ({
          owner: await findImageProfileId(sql, key),
          viewerCode: user.profileId ? await findPublicCode(sql, user.profileId) : null,
        }))
      : null;

  // Import 원본은 주선자 전용이다. 서명이 유출돼도 멤버 세션으로는 열리지 않는다.
  // 다만 게시된 프로필 사진도 원본 키를 그대로 쓰므로, 멤버가 RLS 로 볼 수 있는
  // 프로필에 붙은 사진이면 연다. 있는지 없는지 구분해 주지 않으므로 잘못된 서명과 같은 응답이다.
  if (isHostOnlyKey(key) && user.role !== "ADMIN" && !member?.owner) {
    return fail("FORBIDDEN", "잘못된 링크입니다.", 403);
  }

  const size = await objectSize(key);
  if (size == null) return fail("NOT_FOUND", "파일을 찾을 수 없습니다.", 404);

  // 웹에서는 캡처를 막을 수 없으므로 프로필 사진에는 보는 사람 표시를 합성한다.
  // 주선자는 화면 어디서 보든(가져오기 원본·대행 포함) 주선자 코드가 찍히고, 멤버는
  // 자기 사진만 빠진다. 디코딩하지 못하는 형식(HEIC)은 원본 그대로 나간다.
  const mark =
    user.role === "ADMIN"
      ? isProfilePhotoKey(key)
        ? viewerMark({ role: "ADMIN", userId: user.userId })
        : null
      : member && member.owner !== user.profileId
        ? viewerMark({ role: "MEMBER", userId: user.userId, publicCode: member.viewerCode })
        : null;
  if (mark) {
    const original = await readAll(await openObject(key));
    const marked = await watermarkImage(original, mark);
    if (marked) {
      return new NextResponse(new Uint8Array(marked), {
        headers: { ...PRIVATE_IMAGE_HEADERS, "content-type": "image/jpeg" },
      });
    }
    return new NextResponse(new Uint8Array(original), {
      headers: { ...PRIVATE_IMAGE_HEADERS, "content-type": contentTypeFor(key) },
    });
  }

  const contentType = contentTypeFor(key);
  const stream = Readable.toWeb(
    (await openObject(key)) as Readable,
  ) as WebReadableStream<Uint8Array>;
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      ...PRIVATE_IMAGE_HEADERS,
      "content-type": contentType,
      "content-length": String(size),
    },
  });
});

const PRIVATE_IMAGE_HEADERS = {
  // 서명 URL 이 캐시에 남지 않게 한다.
  "cache-control": "private, no-store",
  "content-disposition": "inline",
  "x-content-type-options": "nosniff",
  // SVG 는 스크립트를 담을 수 있다. 업로드로는 받지 않지만(local.ts 의 허용 목록 참고)
  // 시드가 만든 자리표시 이미지가 SVG 이므로 서빙 시 샌드박스로 무력화한다.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

/** 프로필 사진이 들어 있는 영역(가져오기 원본 포함). 주선자·모임 사진은 아니다. */
function isProfilePhotoKey(key: string): boolean {
  return key.startsWith("profile/") || key.startsWith("import/");
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

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
