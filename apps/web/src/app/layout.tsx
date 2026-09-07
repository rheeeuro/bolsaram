import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Nanum_Myeongjo } from "next/font/google";
import { BRAND } from "@bolsaram/ui-tokens";
import "./globals.css";

const sans = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-clean-sans",
  display: "swap",
});

const display = Nanum_Myeongjo({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-serif-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${BRAND.nameKo} · ${BRAND.nameEn}`,
  description: BRAND.tagline,
  // 비공개 서비스다. 검색엔진에 노출하지 않는다(설계문서 §12).
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fdfbf7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
