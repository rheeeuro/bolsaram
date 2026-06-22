import "./globals.css";

export const metadata = {
  title: "볼사람(bolsaram)",
  description: "소개팅 주선자를 위한 후보 정보 관리 도구",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
