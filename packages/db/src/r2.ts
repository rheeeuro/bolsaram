/** 웹과 정리 CLI가 공유하는 private R2 객체 접근. */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

export function isR2Key(key: string): boolean {
  return /^(profile|import)\/[^/]+\/r2\/[^/]+$/.test(key);
}

export function validateStorageConfig(config: NodeJS.ProcessEnv): void {
  if (config.STORAGE_PROVIDER && !["local", "r2"].includes(config.STORAGE_PROVIDER)) {
    throw new Error("STORAGE_PROVIDER는 local 또는 r2여야 합니다.");
  }
  if (config.STORAGE_PROVIDER === "r2") r2Config(config);
}

function r2Config(config: NodeJS.ProcessEnv) {
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]) {
    if (!config[name]?.trim()) throw new Error(`${name} 설정이 필요합니다.`);
  }
  if (!/^[a-f0-9]{32}$/i.test(config.R2_ACCOUNT_ID!))
    throw new Error("R2_ACCOUNT_ID 형식이 잘못되었습니다.");
  return {
    bucket: config.R2_BUCKET!,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID!,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
      },
    }),
  };
}

let cached: ReturnType<typeof r2Config> | undefined;
function connection(key: string) {
  if (!isR2Key(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("허용되지 않은 R2 저장 키입니다.");
  }
  return (cached ??= r2Config(process.env));
}

export async function putR2Object(key: string, data: Buffer): Promise<void> {
  const { client, bucket } = connection(key);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
}

export async function r2ObjectSize(key: string): Promise<number | null> {
  const { client, bucket } = connection(key);
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return result.ContentLength ?? null;
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
    )
      return null;
    throw error;
  }
}

export async function openR2Object(key: string): Promise<Readable> {
  const { client, bucket } = connection(key);
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("R2 응답 본문이 없습니다.");
  return result.Body as Readable;
}

export async function deleteR2Object(key: string): Promise<void> {
  const { client, bucket } = connection(key);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
