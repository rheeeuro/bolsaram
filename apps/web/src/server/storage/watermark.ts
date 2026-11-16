/**
 * 보는 사람 워터마크. 화면에 나가는 프로필 사진에 열람자 표시를 두 겹으로 넣는다.
 *
 * 웹에서는 캡처를 막을 수 없으므로 막는 대신 **누가 캡처했는지 남긴다.** CSS 로
 * 덮으면 개발자 도구로 걷어낼 수 있어 서버가 픽셀에 직접 합성한다.
 *
 *   보이는 층   굵은 글씨를 비스듬히 여러 줄. 「표시가 있다」는 것 자체로 억제하고, 폰에서
 *              줄여 보다가 캡처해도 번호와 날짜가 맨눈으로 읽히게 한다. 밝은 글자와 어두운
 *              테두리를 반투명하게 겹쳐 어느 바탕에서나 읽힌다.
 *   숨은 층     큰 글씨를 촘촘히, 밝기만 몇 단계 낮춘다. 맨눈으로는 보이지 않지만 얼굴만
 *              잘라도 몇 줄은 남고, 지우기 어렵다. 판독은 주선자 화면 「캡처본 확인」이
 *              주변 밝기를 빼고 차이를 키워서 한다(`lib/trace-enhance.ts`).
 *
 * 표시에는 보는 사람 표기(멤버는 공개 번호,
 * 주선자는 계정 코드)와 날짜만 싣고 이름·연락처는 넣지 않는다.
 */
import "server-only";
import sharp from "sharp";
import { hostViewerCode, memberViewerCode } from "../../lib/viewer-code";

/**
 * 보이는 층 글씨 = 짧은 변 × 이 비율. 폰 화면은 사진을 크게 줄여 보여 주므로(목록 카드는
 * 가로 약 180pt) 그 크기로 캡처해도 글자가 읽혀야 한다. 720px 사진에서 약 18px 다.
 */
const VISIBLE_FONT_RATIO = 0.025;
/** 보이는 층 진하기. 밝은 글자와 어두운 테두리를 겹쳐 밝은 바탕·어두운 바탕 모두에서 읽힌다. */
const VISIBLE_FILL_OPACITY = 0.2;
const VISIBLE_STROKE_OPACITY = 0.13;
/**
 * 숨은 층 글씨 = 짧은 변 × 이 비율. 획이 굵어야 축소·재압축 뒤에도 남는다 —
 * 가는 획은 JPEG 가 먼저 지운다.
 */
const HIDDEN_FONT_RATIO = 0.05;
/**
 * 숨은 층이 낮추는 밝기(0~255 단계). 실측: 3 이상은 평평한 피부에서 확대하면 글자가
 * 비친다. 2 에 가장자리를 넉넉히 흐리면 맨눈으로는 안 보이고, 폰 캡처 → 축소 →
 * 재압축 → 얼굴만 자르기를 거쳐도 번호가 여러 줄에서 읽힌다.
 */
const HIDDEN_DEPTH = 2;
/** 숨은 글자 가장자리를 흐리는 정도 = 글씨 크기 × 이 비율. 경계가 날카로우면 윤곽이 비친다. */
const HIDDEN_SOFTEN_RATIO = 0.03;

export type ViewerMark = {
  /** 보이는 층. `BOLSARAM No.17 26.10.13` */
  visible: string;
  /** 숨은 층. `No.17 261013` — 판독할 때 글자 수가 적을수록 또렷하다. */
  hidden: string;
};

export type MarkViewer =
  | { role: "MEMBER"; userId: string; publicCode: number | null }
  | { role: "ADMIN"; userId: string };

/**
 * 표시 글자 — 보는 사람 표기(`lib/viewer-code.ts`)와 서울 기준 날짜.
 * 주선자는 대행 중이어도 주선자 표기다 — 그 화면을 보는 눈은 주선자다.
 */
export function viewerMark(viewer: MarkViewer, at = new Date()): ViewerMark {
  const [y, m, d] = at.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).split("-");
  const yy = y!.slice(2);
  const who =
    viewer.role === "ADMIN"
      ? hostViewerCode(viewer.userId)
      : memberViewerCode(viewer.publicCode, viewer.userId);
  return { visible: `BOLSARAM ${who} ${yy}.${m}.${d}`, hidden: `${who} ${yy}${m}${d}` };
}

/**
 * 사진에 두 층을 합성해 JPEG 로 돌려준다.
 * 디코딩할 수 없는 형식(HEIC 등)이면 null — 부르는 쪽이 어떻게 할지 정한다.
 * 결과에는 원본 메타데이터(EXIF 위치 정보 등)가 남지 않는다.
 */
export async function watermarkImage(input: Buffer, mark: ViewerMark): Promise<Buffer | null> {
  try {
    // EXIF 방향대로 세운 픽셀에 덮는다. 흑백 사진도 3채널로 맞춘다.
    const { data, info } = await sharp(input)
      .rotate()
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    await embedHiddenMark(data, { width, height, channels }, mark.hidden);

    return await sharp(data, { raw: { width, height, channels } })
      .composite([{ input: Buffer.from(visibleSvg(width, height, mark.visible)), top: 0, left: 0 }])
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * 숨은 층만 raw 픽셀(sRGB, 알파 없음)에 직접 새긴다 — 밝기를 최대 `HIDDEN_DEPTH` 만 낮춘다.
 * 보이는 층과 떼어 둔 것은 이 깊이를 따로 검사하기 위해서다.
 */
export async function embedHiddenMark(
  data: Buffer,
  { width, height, channels }: { width: number; height: number; channels: number },
  label: string,
): Promise<void> {
  const font = fontFor(width, height, HIDDEN_FONT_RATIO, 16, 96);
  const hidden = await sharp(Buffer.from(hiddenSvg(width, height, font, label)))
    .ensureAlpha()
    .extractChannel(3)
    .blur(Math.max(0.8, font * HIDDEN_SOFTEN_RATIO))
    .raw()
    .toBuffer();
  for (let i = 0, p = 0; i < hidden.length; i += 1, p += channels) {
    const a = hidden[i]!;
    if (a === 0) continue;
    const delta = Math.round((HIDDEN_DEPTH * a) / 255);
    for (let c = 0; c < channels; c += 1) data[p + c] = Math.max(0, data[p + c]! - delta);
  }
}

function fontFor(width: number, height: number, ratio: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, Math.min(width, height) * ratio)));
}

function visibleSvg(width: number, height: number, label: string): string {
  const font = fontFor(width, height, VISIBLE_FONT_RATIO, 12, 46);
  // 얼굴만 잘라도 한 줄은 걸리게 줄 간격을 잡는다. 줄마다 반 칸씩 엇갈린다.
  const tileW = font * 28;
  const tileH = font * 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g transform="rotate(-24)" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${font}" letter-spacing="${font * 0.07}"
     fill="#ffffff" fill-opacity="${VISIBLE_FILL_OPACITY}"
     stroke="#000000" stroke-opacity="${VISIBLE_STROKE_OPACITY}" stroke-width="${(font * 0.065).toFixed(2)}" paint-order="stroke">
    ${staggered(escapeXml(label), { x: font, tileW, rowGap: tileH / 2, angle: -24, width, height })}
  </g>
</svg>`;
}

function hiddenSvg(width: number, height: number, font: number, label: string): string {
  // 빈틈 없이 촘촘히 — 얼굴만 잘라 가도 온전한 한 줄이 남게 한다. 보이는 층과 반대로 기울인다.
  const tileW = Math.round(font * label.length * 0.75);
  const tileH = Math.round(font * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g transform="rotate(18)" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${font}" fill="#ffffff">
    ${staggered(escapeXml(label), { x: 0, tileW, rowGap: tileH, angle: 18, width, height })}
  </g>
</svg>`;
}

/**
 * 기울인 격자에 글자를 엇갈려 늘어놓는다 — 칸마다 가운데 줄 하나와, 반 칸 밀린 줄 하나.
 * 회전된 `<pattern>` 은 librsvg 가 느린 길로 그려(1280px 사진에서 층마다 약 0.2초) 글자를
 * 직접 놓는다. 기울인 좌표에서 사진 네 모서리를 감싸는 범위만 채운다.
 */
function staggered(
  text: string,
  { x, tileW, rowGap, angle, width, height }: {
    x: number;
    tileW: number;
    rowGap: number;
    angle: number;
    width: number;
    height: number;
  },
): string {
  const rad = (-angle * Math.PI) / 180;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([cx, cy]) => [
    cx! * Math.cos(rad) - cy! * Math.sin(rad),
    cx! * Math.sin(rad) + cy! * Math.cos(rad),
  ]);
  // 글자가 칸보다 길지 않으므로 한 칸 여유면 가장자리에 걸친 글자까지 그린다.
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  const [x0, x1] = [Math.min(...xs) - tileW, Math.max(...xs) + tileW];
  const [y0, y1] = [Math.min(...ys) - tileW, Math.max(...ys) + tileW];
  const period = rowGap * 2;
  const out: string[] = [];
  for (let j = Math.floor(y0 / period); j * period <= y1; j += 1) {
    for (let i = Math.floor(x0 / tileW); i * tileW <= x1; i += 1) {
      out.push(
        `<text x="${x + i * tileW}" y="${rowGap + j * period}">${text}</text>`,
        `<text x="${x + tileW / 2 + i * tileW}" y="${j * period}">${text}</text>`,
      );
    }
  }
  return out.join("");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
