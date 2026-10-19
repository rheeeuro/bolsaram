import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../packages/db/node_modules/@aws-sdk/client-s3", async (original) => {
  const sdk = await original<Record<string, unknown>>();
  return {
    ...sdk,
    S3Client: class {
      send = send;
    },
  };
});
import {
  isR2Key,
  validateStorageConfig,
  putR2Object,
  r2ObjectSize,
  readR2Object,
  deleteR2Object,
} from "../packages/db/src/r2";

describe("private R2 storage", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    send.mockReset();
    vi.stubEnv("R2_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("R2_BUCKET", "test-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  });

  it("distinguishes existing local keys and rejects traversal before sending", async () => {
    expect(isR2Key("profile/id/photo.jpg")).toBe(false);
    expect(isR2Key("import/id/r2/photo.jpg")).toBe(true);
    await expect(deleteR2Object("profile/../r2/photo.jpg")).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("requires complete R2 configuration", () => {
    expect(() => validateStorageConfig({ STORAGE_PROVIDER: "local" })).not.toThrow();
    expect(() => validateStorageConfig({ STORAGE_PROVIDER: "r2" })).toThrow("R2_ACCOUNT_ID");
    expect(() => validateStorageConfig({ STORAGE_PROVIDER: "unknown" })).toThrow();
  });

  it("sends uploads and deletes to the private bucket without public ACL", async () => {
    send.mockResolvedValue({});
    const key = "profile/id/r2/photo.jpg";
    const body = Buffer.from("synthetic");
    await putR2Object(key, body);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "test-bucket",
      Key: key,
      Body: body,
    });
    await deleteR2Object(key);
    expect(send.mock.calls[1]?.[0].input).toEqual({ Bucket: "test-bucket", Key: key });
  });

  it("treats only missing objects as absent, propagating service failures", async () => {
    const key = "import/id/r2/photo.jpg";
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await r2ObjectSize(key)).toBeNull();
    const error = { $metadata: { httpStatusCode: 403 } };
    send.mockRejectedValueOnce(error);
    await expect(r2ObjectSize(key)).rejects.toBe(error);
    send.mockResolvedValueOnce({ ContentLength: 42 });
    expect(await r2ObjectSize(key)).toBe(42);
  });

  it("reads a whole object in one request, null only when missing", async () => {
    const key = "profile/id/r2/photo.jpg";
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    expect(await readR2Object(key)).toEqual(Buffer.from([1, 2, 3]));
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await readR2Object(key)).toBeNull();
    const error = { $metadata: { httpStatusCode: 500 } };
    send.mockRejectedValueOnce(error);
    await expect(readR2Object(key)).rejects.toBe(error);
  });
});

/**
 * 사진 응답은 보는 사람의 브라우저에 잠깐 남는다. 같은 구간 안에서 URL 이 같아야
 * 다시 쓸 수 있고, 워터마크의 날짜가 바뀌는 서울 자정을 넘겨 남으면 안 된다.
 */
describe("사진 URL 과 브라우저 캐시", () => {
  it("같은 TTL 구간 안에서는 만료 시각이 같고, 최소 TTL 만큼은 유효하다", async () => {
    const { alignedExpiry } = await import("../apps/web/src/server/storage/local");
    const ttl = 300;
    const start = 1_800_000_000 - (1_800_000_000 % ttl);
    expect(alignedExpiry(start, ttl)).toBe(alignedExpiry(start + ttl - 1, ttl));
    expect(alignedExpiry(start + ttl, ttl)).toBe(alignedExpiry(start, ttl) + ttl);
    for (const now of [start, start + 1, start + ttl - 1]) {
      const exp = alignedExpiry(now, ttl);
      expect(exp - now).toBeGreaterThanOrEqual(ttl);
      expect(exp - now).toBeLessThanOrEqual(ttl * 2);
    }
  });

  it("캐시 시간은 만료까지이되 서울 자정을 넘지 않는다", async () => {
    const { privateCacheSeconds } = await import("../apps/web/src/server/storage/local");
    // 서울 12:00 = UTC 03:00
    const noon = Date.UTC(2026, 9, 19, 3, 0, 0) / 1000;
    expect(privateCacheSeconds(noon + 400, noon)).toBe(400);
    // 서울 23:58 — 2분 뒤 날짜가 바뀐다
    const lateNight = Date.UTC(2026, 9, 19, 14, 58, 0) / 1000;
    expect(privateCacheSeconds(lateNight + 400, lateNight)).toBe(120);
    expect(privateCacheSeconds(noon - 1, noon)).toBe(0);
  });
});

/**
 * 서명 URL 은 로그인한 사람이면 누구나 쓸 수 있다(유출·복사). 그래서 주선자 화면에서만
 * 나오는 영역은 키 자체로 한 번 더 가른다.
 */
describe("스토리지 키 경계", () => {
  it("Import 원본은 주선자 전용 영역이다", async () => {
    const { isHostOnlyKey } = await import("../apps/web/src/server/storage/local");
    expect(isHostOnlyKey("import/abc/x.jpg")).toBe(true);
    expect(isHostOnlyKey("profile/abc/x.jpg")).toBe(false);
    expect(isHostOnlyKey("avatar/abc/x.jpg")).toBe(false);
    expect(isHostOnlyKey("group/abc/x.jpg")).toBe(false);
  });
});
