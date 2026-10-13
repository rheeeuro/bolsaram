/**
 * 캡처본에서 숨은 워터마크 층을 드러낸다.
 *
 * 숨은 층은 글자 자리의 밝기를 몇 단계 낮춘 것이다(`server/storage/watermark.ts`).
 * 그래서 각 점에서 **주변 평균 밝기를 빼면** 사진의 큰 명암은 사라지고 글자만 남는다.
 * 남은 차이를 크게 키워 회색 바탕 위의 어두운 글자로 보여준다.
 *
 * 브라우저에서 캔버스 픽셀을 받아 그대로 돌린다 — 캡처본을 서버로 보내지 않는다.
 */

export type EnhanceOptions = {
  /** 주변 평균을 잡을 반경(px). 글자 획보다 커야 획이 바탕으로 빨려 들어가지 않는다. */
  radius: number;
  /** 차이를 몇 배로 키울지. */
  gain: number;
};

/** 사진 크기에 맞는 기본값. 숨은 글씨는 짧은 변의 약 5% 라 반경을 그 절반쯤으로 잡는다. */
export function defaultEnhanceOptions(width: number, height: number): EnhanceOptions {
  return { radius: Math.max(2, Math.round(Math.min(width, height) / 50)), gain: 16 };
}

/** RGBA 픽셀 → 드러낸 결과(RGBA, 회색조). 입력은 바꾸지 않는다. */
export function enhanceTrace(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  { radius, gain }: EnhanceOptions,
): Uint8ClampedArray<ArrayBuffer> {
  const size = width * height;
  const luma = new Float32Array(size);
  for (let i = 0, p = 0; i < size; i += 1, p += 4) {
    luma[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
  }

  const mean = boxMean(luma, width, height, Math.max(1, Math.round(radius)));
  const diff = new Float32Array(size);
  for (let i = 0; i < size; i += 1) diff[i] = luma[i]! - mean[i]!;

  // JPEG 잡음이 함께 커지므로 5×5 로 한 번 고른다. 숨은 글자 획은 이보다 굵다.
  const smooth = boxMean(diff, width, height, 2);

  const out = new Uint8ClampedArray(size * 4);
  for (let i = 0, p = 0; i < size; i += 1, p += 4) {
    const v = 128 + smooth[i]! * gain;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}

/** 반경 r 정사각형 평균. 적분 영상으로 반경과 무관하게 한 번에 구한다. 가장자리는 안쪽만 센다. */
function boxMean(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += src[y * width + x]!;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum =
        integral[y1 * stride + x1]! -
        integral[y0 * stride + x1]! -
        integral[y1 * stride + x0]! +
        integral[y0 * stride + x0]!;
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}
