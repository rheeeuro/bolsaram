/**
 * 로컬 private 스토리지.
 * Supabase Storage 대체물이며 계약을 맞춰둔다 — 나중에 객체 스토리지로 갈아끼울 때
 * `putObject / readObject / signDownloadUrl / signUploadToken` 만 바꾸면 된다.
 *
 * 규칙(설계문서 §12):
 *   * 저장 경로는 웹 루트 밖이다. 정적 서빙되지 않는다.
 *   * 영구 공개 URL 을 만들지 않는다. 다운로드는 단기 signed URL 로만.
 *   * 저장 키는 예측 불가능한 난수를 포함한다.
 */
import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { b64url, hmac, randomToken, safeEqual } from "../crypto";
import { randomBytes } from "node:crypto";

export type StorageNamespace = "profile" | "import";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimeType.toLowerCase());
}

/**
 * 저장소 루트.
 * STORAGE_ROOT 는 절대경로를 권장한다 — 웹 서버(cwd=apps/web)와 CLI(cwd=리포 루트)가
 * 같은 디렉터리를 가리켜야 하기 때문이다. 상대경로면 실행 위치 기준으로 해석된다.
 */
function storageRoot(): string {
  return path.resolve(env().STORAGE_ROOT);
}

/**
 * 저장 키를 만든다. `<namespace>/<ownerId>/<random>.<ext>`
 * ownerId 로 묶어두면 프로필 삭제 시 하위 전체를 지우기 쉽다.
 */
export function buildStorageKey(
  namespace: StorageNamespace,
  ownerId: string,
  mimeType: string,
): string {
  const ext = extensionFor(mimeType);
  return `${namespace}/${ownerId}/${b64url(randomBytes(12))}${ext}`;
}

function extensionFor(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    default:
      return ".bin";
  }
}

/** 경로 탈출을 막는다. 저장 키는 항상 이 함수를 통과해야 한다. */
function resolveSafe(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("허용되지 않은 저장 경로입니다.");
  }
  return full;
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const full = resolveSafe(key);
  await mkdir(path.dirname(full), { recursive: true });
  // 부분 쓰기가 유효한 파일로 보이지 않도록 임시 파일에 쓰고 원자적으로 옮긴다.
  const tmp = `${full}.${randomToken(6)}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, full);
}

export async function objectSize(key: string): Promise<number | null> {
  try {
    const info = await stat(resolveSafe(key));
    return info.size;
  } catch {
    return null;
  }
}

export function openObject(key: string): NodeJS.ReadableStream {
  return createReadStream(resolveSafe(key));
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await unlink(resolveSafe(key));
  } catch (error) {
    // 이미 없는 파일은 성공으로 본다. 그 외 오류는 올린다.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

// ── signed URL ────────────────────────────────────────────────

type SignedPurpose = "download" | "upload";

function signaturePayload(purpose: SignedPurpose, key: string, expiresAt: number): string {
  return `${purpose}:${key}:${expiresAt}`;
}

/**
 * 단기 다운로드 URL. 기본 TTL 은 STORAGE_SIGNED_URL_TTL(초).
 * 반환값은 상대 경로이며 로그에 남기지 않는다.
 */
export function signDownloadUrl(key: string, ttlSeconds?: number): string {
  const ttl = ttlSeconds ?? env().STORAGE_SIGNED_URL_TTL;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = hmac(env().STORAGE_SECRET, signaturePayload("download", key, exp));
  const params = new URLSearchParams({ key, exp: String(exp), sig });
  return `/api/files?${params.toString()}`;
}

/**
 * 직접 업로드 토큰. 클라이언트는 이 토큰으로 `PUT /api/uploads` 를 호출한다.
 * 서버가 미리 키를 발급하므로 클라이언트가 경로를 정할 수 없다.
 */
export function signUploadToken(key: string, ttlSeconds = 900): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(env().STORAGE_SECRET, signaturePayload("upload", key, exp));
  return `${exp}.${sig}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "expired" | "invalid" };

export function verifySignature(
  purpose: SignedPurpose,
  key: string,
  exp: string | number,
  sig: string,
): VerifyResult {
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "invalid" };
  if (expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  const expected = hmac(env().STORAGE_SECRET, signaturePayload(purpose, key, expiresAt));
  return safeEqual(expected, sig) ? { ok: true } : { ok: false, reason: "invalid" };
}

export function verifyUploadToken(key: string, token: string): VerifyResult {
  const dot = token.indexOf(".");
  if (dot < 0) return { ok: false, reason: "invalid" };
  return verifySignature("upload", key, token.slice(0, dot), token.slice(dot + 1));
}
