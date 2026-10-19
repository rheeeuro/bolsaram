/**
 * 보는 사람 워터마크.
 *
 * 캡처는 막을 수 없으므로 멤버에게 나가는 사진에 열람자 표시를 남긴다. 표시가 빠지거나
 * 사진이 돌아가 나가면 장치가 소리 없이 무력해지므로 여기서 성질을 고정한다.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { viewerMark, watermarkImage } from "../apps/web/src/server/storage/watermark";
import { defaultEnhanceOptions, enhanceTrace } from "../apps/web/src/lib/trace-enhance";
import { hostViewerCode, parseTraceCode } from "../apps/web/src/lib/viewer-code";

// sharp 는 웹 앱의 의존성이다. 테스트도 같은 사본을 써서 입력 사진을 만든다.
const sharp = createRequire(new URL("../apps/web/package.json", import.meta.url))(
  "sharp",
) as typeof import("sharp");

const MARK = viewerMark(
  { role: "MEMBER", userId: "u", publicCode: 17 },
  new Date("2026-10-13T03:00:00Z"),
);

async function photo(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 44, b: 60 } },
  }).jpeg();
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
}

describe("표시 글자", () => {
  it("공개 번호와 서울 기준 날짜를 두 층에 싣는다", () => {
    // UTC 15:30 은 서울로 다음 날 00:30 이다.
    const mark = viewerMark(
      { role: "MEMBER", userId: "u", publicCode: 17 },
      new Date("2026-10-12T15:30:00Z"),
    );
    expect(mark).toEqual({ visible: "BOLSARAM No.17 26.10.13", hidden: "No.17 261013" });
  });

  it("번호가 없으면 계정 id 앞자리로 대신한다", () => {
    const mark = viewerMark(
      { role: "MEMBER", userId: "8f3a2c1d-0000", publicCode: null },
      new Date("2026-10-13T03:00:00Z"),
    );
    expect(mark.visible).toBe("BOLSARAM U-8f3a2c1d 26.10.13");
  });

  it("주선자는 계정 코드를 싣는다 — 대행 중이어도 같다", () => {
    const mark = viewerMark(
      { role: "ADMIN", userId: "8f3a2c1d-4b5e-4000-8000-000000000000" },
      new Date("2026-10-13T03:00:00Z"),
    );
    expect(mark).toEqual({ visible: "BOLSARAM H-8F3A2C 26.10.13", hidden: "H-8F3A2C 261013" });
  });

  it("ASCII 만 쓴다 — 서버 글꼴에 한글이 없어도 깨지지 않는다", () => {
    const mark = viewerMark({ role: "ADMIN", userId: "8f3a2c1d-4b5e" });
    expect(mark.visible + mark.hidden).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("읽은 표기 판독", () => {
  it.each([
    ["17", { kind: "member", publicCode: 17 }],
    ["No.17 261013", { kind: "member", publicCode: 17 }],
    ["no 17", { kind: "member", publicCode: 17 }],
    ["17번", { kind: "member", publicCode: 17 }],
    ["H-8F3A2C 261013", { kind: "host", prefix: "8f3a2c" }],
    ["h8f3a2c", { kind: "host", prefix: "8f3a2c" }],
  ])("%s", (input, expected) => {
    expect(parseTraceCode(input)).toEqual(expected);
  });

  it("표기가 아니면 null", () => {
    expect(parseTraceCode("BOLSARAM")).toBeNull();
    expect(parseTraceCode("H-12")).toBeNull();
  });

  it("주선자 코드는 계정 id 앞 여섯 자리를 대문자로", () => {
    expect(hostViewerCode("8f3a2c1d-4b5e-4000-8000-000000000000")).toBe("H-8F3A2C");
  });
});

describe("합성", () => {
  it("크기를 그대로 두고 픽셀에 표시가 들어간다", async () => {
    const input = await photo(640, 800);
    const output = await watermarkImage(input, MARK);
    expect(output).not.toBeNull();
    const meta = await sharp(output!).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([640, 800]);

    const before = await sharp(input).raw().toBuffer();
    const after = await sharp(output!).raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < before.length; i += 1) {
      if (Math.abs(before[i]! - after[i]!) > 6) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("방향 정보대로 세워서 내보내고, 원본 메타데이터는 남기지 않는다", async () => {
    // 6 = 시계 방향 90° — 저장은 가로, 보이는 것은 세로다.
    const input = await photo(800, 600, 6);
    const output = await watermarkImage(input, MARK);
    const meta = await sharp(output!).metadata();
    expect([meta.width, meta.height]).toEqual([600, 800]);
    expect(meta.orientation ?? 1).toBe(1);
    expect(meta.exif).toBeUndefined();
  });

  it("열 수 없는 파일이면 null — 부르는 쪽이 원본을 낼지 정한다", async () => {
    expect(await watermarkImage(Buffer.from("not an image"), MARK)).toBeNull();
  });
});

describe("숨은 층 판독", () => {
  /** 캡처본 확인 화면과 같은 계산으로 드러낸 뒤, 바탕(128)에서 크게 벗어난 점의 비율. */
  async function revealed(image: Buffer): Promise<number> {
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const out = enhanceTrace(
      new Uint8ClampedArray(data),
      info.width,
      info.height,
      defaultEnhanceOptions(info.width, info.height),
    );
    let strong = 0;
    for (let p = 0; p < out.length; p += 4) if (Math.abs(out[p]! - 128) > 12) strong += 1;
    return strong / (out.length / 4);
  }

  it("축소·재압축·잘라내기를 거쳐도 표시 없는 사진과 뚜렷이 갈린다", async () => {
    // 평평한 바탕 = 숨은 층이 가장 들키기 쉬운 곳이자 판독이 가장 쉬운 곳.
    const input = await sharp({
      create: { width: 1024, height: 1280, channels: 3, background: { r: 233, g: 201, b: 180 } },
    })
      .jpeg({ quality: 92 })
      .toBuffer();
    const leak = async (image: Buffer) =>
      sharp(await sharp(image).resize(700).jpeg({ quality: 70 }).toBuffer())
        .extract({ left: 150, top: 200, width: 300, height: 300 })
        .toBuffer();

    const clean = await revealed(await leak(input));
    const marked = await revealed(await leak((await watermarkImage(input, MARK))!));
    expect(clean).toBeLessThan(0.01);
    expect(marked).toBeGreaterThan(0.05);
  });

  it("숨은 층은 밝기를 2 단계 넘게 바꾸지 않는다", async () => {
    // 보이는 층이 지나가지 않는 자리를 찾기 어려우므로, 바뀐 점 대부분이 2 이하인지 본다.
    const input = await sharp({
      create: { width: 600, height: 600, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();
    const output = (await watermarkImage(input, MARK))!;
    const before = await sharp(input).raw().toBuffer();
    const after = await sharp(output).raw().toBuffer();
    let changed = 0;
    let small = 0;
    for (let i = 0; i < before.length; i += 1) {
      const d = Math.abs(before[i]! - after[i]!);
      if (d === 0) continue;
      changed += 1;
      if (d <= 3) small += 1; // JPEG 반올림 1 단계 여유
    }
    expect(small / changed).toBeGreaterThan(0.8);
  });
});
