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
  // 파일 규약(app/icon.png) 대신 여기서 명시한다 — 크기별 파일이 여러 개고
  // manifest 가 같은 경로를 가리키므로 한곳에 모아 두는 편이 맞다.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/favicon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/favicon-180.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  // 홈 화면에 담았을 때 브랜드명으로 뜬다. 카피가 아니라 이름만 쓴다.
  appleWebApp: { capable: true, title: BRAND.nameKo, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale 을 두지 않는다 — 사진과 소개글을 읽는 화면에서 확대를 막으면 안 된다.
  // 입력 포커스 시 iOS 자동 확대는 globals.css 가 폼 컨트롤을 16px 로 올려 막는다.
  themeColor: "#fdfbf7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
