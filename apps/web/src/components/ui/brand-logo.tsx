import Image from "next/image";
import { BRAND } from "@bolsaram/ui-tokens";
import { cn } from "@/lib/cn";

/**
 * 브랜드 로고. `public/` 의 원본 PNG 를 그대로 쓴다.
 *
 * 원본 캔버스에는 여백이 비대칭으로 들어 있다(symbol 은 위쪽 30%·오른쪽 28%가 비고,
 * 가로 로고는 위쪽 35%가 빈다). 높이만 맞춰 넣으면 로고가 눈에 보이게 치우치므로
 * 실측한 글리프 경계만 잘라 보여준다. `wordmark` 는 가로 로고에서 「볼사람」 부분만
 * 잘라낸 것이다 — 전체 락업을 네비 높이로 줄이면 「BOLSARAM」이 5px 가 되어 읽히지 않는다.
 *
 * 아래 좌표는 알파 채널 실측값이다. **원본 에셋을 갱신하면 다시 재야 한다**
 * (`assets/README.md` 의 버전이 올라가면 여기도 확인한다).
 */
const CROPS = {
  /** 「볼사람」 워드마크만. 네비·헤더처럼 높이가 낮은 곳. */
  wordmark: { src: "/bolsaram-logo-horizontal.png", w: 2640, h: 630, x: 74, y: 223, cw: 1112, ch: 346 },
  /** 「볼사람 | BOLSARAM」 가로 락업. 세로로 여유가 없고 가로가 넓을 때. */
  lockup: { src: "/bolsaram-logo-horizontal.png", w: 2640, h: 630, x: 74, y: 223, cw: 2436, ch: 346 },
  /** 「볼사람」 위, 「BOLSARAM」 아래. 인트로처럼 크게 놓는 곳. */
  stacked: { src: "/bolsaram-logo-primary.png", w: 1860, h: 960, x: 81, y: 125, cw: 1697, ch: 734 },
  /** 심볼 마크만. 글자를 함께 보여줄 수 없는 좁은 자리. */
  symbol: { src: "/bolsaram-symbol.png", w: 1080, h: 840, x: 159, y: 256, cw: 623, ch: 502 },
} as const;

export type BrandLogoVariant = keyof typeof CROPS;

export function BrandLogo({
  variant = "wordmark",
  height,
  /** 옆에 브랜드명이 이미 글자로 있으면 `""` 를 줘서 중복 낭독을 막는다. */
  alt = BRAND.nameKo,
  className,
  eager,
}: {
  variant?: BrandLogoVariant;
  /** 잘라낸 글리프 영역의 표시 높이(px). 폭은 비율로 정해진다. */
  height: number;
  alt?: string;
  className?: string;
  /** 첫 화면에 바로 보이는 자리(헤더·인트로)면 켠다. 기본은 지연 로딩이다. */
  eager?: boolean;
}) {
  const crop = CROPS[variant];
  const scale = height / crop.ch;
  // next/image 에는 실제로 그려지는 크기를 준다 — 원본 크기를 주면 2640px 짜리를
  // 그대로 내려보낸다.
  const drawnWidth = Math.round(crop.w * scale);
  const drawnHeight = Math.round(crop.h * scale);

  return (
    <span
      className={cn("relative block overflow-hidden", className)}
      style={{ width: Math.round(crop.cw * scale), height }}
    >
      <Image
        src={crop.src}
        alt={alt}
        width={drawnWidth}
        height={drawnHeight}
        loading={eager ? "eager" : "lazy"}
        className="absolute max-w-none"
        style={{ left: -Math.round(crop.x * scale), top: -Math.round(crop.y * scale) }}
      />
    </span>
  );
}
