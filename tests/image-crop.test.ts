/**
 * 사진에서 쓸 영역을 고르는 계산.
 *
 * 화면은 사진을 정해진 비율로 잘라 보여준다. 주선자가 맞춘 자리와 실제로 저장되는
 * 자리가 어긋나면 **얼굴이 잘린 사진이 그대로 남는다** — 되돌리려면 지우고 다시
 * 올려야 하므로 여기서 성질을 고정한다.
 *
 * 브라우저 없이 검증할 수 있는 것만 본다(좌표·크기). 실제로 그리는 일은 캔버스가 한다.
 */
import { describe, expect, it } from "vitest";
import {
  clampOffset,
  coverScale,
  cropRect,
  outputSize,
} from "../apps/web/src/lib/crop-rect";

const SQUARE = { width: 320, height: 320 };
const PORTRAIT_FRAME = { width: 288, height: 384 };

describe("덮는 배율", () => {
  it("가로로 긴 사진은 높이를 기준으로 덮는다", () => {
    expect(coverScale({ width: 4000, height: 2000 }, SQUARE)).toBe(320 / 2000);
  });

  it("세로로 긴 사진은 폭을 기준으로 덮는다", () => {
    expect(coverScale({ width: 1000, height: 3000 }, SQUARE)).toBe(320 / 1000);
  });

  it("크기를 모르는 사진은 0 이다 — 아직 그릴 수 없다", () => {
    expect(coverScale({ width: 0, height: 0 }, SQUARE)).toBe(0);
  });
});

describe("밀 수 있는 범위", () => {
  it("남는 만큼만 밀린다", () => {
    const display = { width: 640, height: 320 };
    expect(clampOffset({ x: 1000, y: 0 }, display, SQUARE)).toEqual({ x: 160, y: 0 });
    expect(clampOffset({ x: -1000, y: 0 }, display, SQUARE)).toEqual({ x: -160, y: 0 });
  });

  it("딱 맞는 방향으로는 움직이지 않는다 — 밀면 빈자리가 생긴다", () => {
    const display = { width: 320, height: 640 };
    expect(clampOffset({ x: 50, y: 50 }, display, SQUARE)).toEqual({ x: 0, y: 50 });
  });
});

describe("잘라 낼 사각형", () => {
  it("기본 배율의 가로 사진은 세로 전부와 가운데 폭을 쓴다", () => {
    const natural = { width: 4000, height: 2000 };
    const scale = coverScale(natural, SQUARE);
    const rect = cropRect({ natural, frame: SQUARE, offset: { x: 0, y: 0 }, scale });

    expect(rect.sh).toBe(2000);
    expect(rect.sw).toBe(2000);
    expect(rect.sy).toBe(0);
    expect(rect.sx).toBe(1000);
  });

  it("세로 틀(3:4)은 사진 비율이 아니라 틀 비율로 잘린다", () => {
    const natural = { width: 1200, height: 1200 };
    const scale = coverScale(natural, PORTRAIT_FRAME);
    const rect = cropRect({ natural, frame: PORTRAIT_FRAME, offset: { x: 0, y: 0 }, scale });

    expect(rect.sw / rect.sh).toBeCloseTo(288 / 384, 6);
    expect(rect.sh).toBe(1200);
  });

  it("민 방향으로 잘리는 자리가 따라온다", () => {
    const natural = { width: 4000, height: 2000 };
    const scale = coverScale(natural, SQUARE);
    const centered = cropRect({ natural, frame: SQUARE, offset: { x: 0, y: 0 }, scale });
    // 사진을 오른쪽으로 밀면 **왼쪽**이 틀에 들어온다.
    const moved = cropRect({ natural, frame: SQUARE, offset: { x: 160, y: 0 }, scale });

    expect(moved.sx).toBeLessThan(centered.sx);
    expect(moved.sx).toBe(centered.sx - 160 / scale);
  });

  it("확대하면 쓰는 범위가 좁아진다", () => {
    const natural = { width: 4000, height: 2000 };
    const base = coverScale(natural, SQUARE);
    const wide = cropRect({ natural, frame: SQUARE, offset: { x: 0, y: 0 }, scale: base });
    const close = cropRect({ natural, frame: SQUARE, offset: { x: 0, y: 0 }, scale: base * 2 });

    expect(close.sw).toBeCloseTo(wide.sw / 2, 6);
    expect(close.sh).toBeCloseTo(wide.sh / 2, 6);
  });

  it("밀 수 있는 끝까지 가도 원본 밖을 집지 않는다", () => {
    const natural = { width: 1000, height: 3000 };
    const frame = PORTRAIT_FRAME;
    const scale = coverScale(natural, frame) * 1.7;
    const display = { width: natural.width * scale, height: natural.height * scale };

    for (const raw of [
      { x: -9999, y: -9999 },
      { x: 9999, y: 9999 },
      { x: 9999, y: -9999 },
      { x: -9999, y: 9999 },
    ]) {
      const offset = clampOffset(raw, display, frame);
      const rect = cropRect({ natural, frame, offset, scale });
      expect(rect.sx).toBeGreaterThanOrEqual(0);
      expect(rect.sy).toBeGreaterThanOrEqual(0);
      expect(rect.sx + rect.sw).toBeLessThanOrEqual(natural.width + 1e-6);
      expect(rect.sy + rect.sh).toBeLessThanOrEqual(natural.height + 1e-6);
    }
  });

  it("배율을 모르면 아무것도 자르지 않는다", () => {
    const rect = cropRect({
      natural: { width: 100, height: 100 },
      frame: SQUARE,
      offset: { x: 0, y: 0 },
      scale: 0,
    });
    expect(rect).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe("저장 크기", () => {
  it("긴 변이 한계를 넘으면 비율을 지켜 줄인다", () => {
    const size = outputSize({ sx: 0, sy: 0, sw: 3000, sh: 4000 }, 1280);
    expect(size.height).toBe(1280);
    expect(size.width).toBe(960);
  });

  it("작은 사진은 늘리지 않는다 — 없는 화질을 만들지 않는다", () => {
    expect(outputSize({ sx: 0, sy: 0, sw: 400, sh: 300 }, 1280)).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("아주 납작한 영역도 한 픽셀은 남는다", () => {
    expect(outputSize({ sx: 0, sy: 0, sw: 1280, sh: 0.2 }, 1280).height).toBe(1);
  });
});
