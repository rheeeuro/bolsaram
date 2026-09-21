/**
 * 사진에서 **쓸 영역**을 고르는 계산. 화면(`components/ui/image-cropper.tsx`)은 이 값으로
 * 사진을 그리고, 같은 값으로 캔버스를 잘라 낸다.
 *
 * 화면 좌표는 「틀 가운데에서 얼마나 밀렸는가(offset)」와 「원본 1px 이 화면 몇 px 인가
 * (scale)」 두 가지뿐이다. 여기서 원본 좌표로 되짚는다.
 *
 * 그림이 없는 자리에서 검증할 수 있도록 순수 함수로 두었다 — 자르는 자리가 한 번
 * 어긋나면 얼굴이 잘린 사진이 그대로 저장된다.
 */

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** 원본에서 잘라 낼 사각형. 캔버스 `drawImage` 의 source 인자와 같은 뜻이다. */
export type CropRect = { sx: number; sy: number; sw: number; sh: number };

/** 사진이 틀을 빈자리 없이 덮는 최소 배율. 확대는 여기서부터 시작한다. */
export function coverScale(natural: Size, frame: Size): number {
  if (natural.width === 0 || natural.height === 0) return 0;
  return Math.max(frame.width / natural.width, frame.height / natural.height);
}

/**
 * 밀 수 있는 만큼만 민다. 틀 밖으로 사진이 끌려 나가면 빈자리가 생기고, 그 자리는
 * 잘라 낸 결과에서 투명해진다.
 */
export function clampOffset(offset: Point, display: Size, frame: Size): Point {
  const maxX = Math.max(0, (display.width - frame.width) / 2);
  const maxY = Math.max(0, (display.height - frame.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

/**
 * 지금 틀에 보이는 부분이 원본의 어디인가.
 *
 * 소수점 오차로 원본 밖을 집으면 가장자리 한 줄이 비므로 안쪽으로 붙인다.
 */
export function cropRect({
  natural,
  frame,
  offset,
  scale,
}: {
  natural: Size;
  frame: Size;
  offset: Point;
  scale: number;
}): CropRect {
  if (scale <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };

  const display = { width: natural.width * scale, height: natural.height * scale };
  const left = frame.width / 2 + offset.x - display.width / 2;
  const top = frame.height / 2 + offset.y - display.height / 2;

  const sw = Math.min(frame.width / scale, natural.width);
  const sh = Math.min(frame.height / scale, natural.height);
  return {
    sx: Math.min(Math.max(-left / scale, 0), natural.width - sw),
    sy: Math.min(Math.max(-top / scale, 0), natural.height - sh),
    sw,
    sh,
  };
}

/**
 * 저장할 크기. 긴 변을 한계까지만 쓰고 비율은 그대로 둔다 — 원본 해상도를 그대로
 * 저장하면 화면에 쓰이지도 않는 용량이 스토리지에 쌓인다.
 */
export function outputSize(rect: CropRect, max: number): Size {
  const longest = Math.max(rect.sw, rect.sh);
  const ratio = longest > max ? max / longest : 1;
  return {
    width: Math.max(1, Math.round(rect.sw * ratio)),
    height: Math.max(1, Math.round(rect.sh * ratio)),
  };
}
