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
