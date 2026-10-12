import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// 환경변수는 리포 루트의 .env 에 둔다(CLI 와 웹이 같은 파일을 본다).
// Next 는 앱 디렉터리 기준으로만 .env 를 찾으므로 여기서 직접 읽어들인다.
const repoRoot = path.resolve(import.meta.dirname, "../..");
for (const file of [".env", ".env.local"]) {
  const full = path.join(repoRoot, file);
  if (existsSync(full)) process.loadEnvFile(full);
}

const config: NextConfig = {
  // 워크스페이스 패키지를 TS 소스 그대로 가져온다(별도 빌드 단계 없음).
  transpilePackages: [
    "@bolsaram/domain",
    "@bolsaram/schemas",
    "@bolsaram/ui-tokens",
    "@bolsaram/db",
  ],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  async redirects() {
    // 같은 화면이 다른 주소(www·http)로도 열리면 canonical 이 있어도 검색엔진이
    // 「대체 페이지」로 따로 센다. 공개 도메인 하나로 영구 이동시킨다.
    // 로컬(http://localhost)과 감시기·헬스체크가 부르는 localhost 는 건드리지 않는다.
    const raw = process.env.APP_ORIGIN;
    if (!raw?.startsWith("https://")) return [];
    const origin = new URL(raw).origin;
    const host = new URL(raw).host;
    const destination = `${origin}/:path*`;
    return [
      ...(host.startsWith("www.")
        ? []
        : [
            {
              source: "/:path*",
              has: [{ type: "host" as const, value: `www\\.${host.replaceAll(".", "\\.")}` }],
              destination,
              permanent: true,
            },
          ]),
      {
        // Cloudflare 가 방문자의 원래 scheme 을 CF-Visitor({"scheme":"http"})로 넘긴다.
        // 따옴표까지 맞춰야 "https" 와 구분된다.
        source: "/:path*",
        has: [{ type: "header" as const, key: "cf-visitor", value: '.*"http".*' }],
        destination,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // 첫 화면(`/`)과 처리방침(`/privacy`)을 뺀 전부에 색인 금지를 건다.
        // 헤더와 메타가 다르면 구글은 엄격한 쪽을 따르므로 여기서 빼야 열린다.
        // 여는 목록은 app/robots.ts · app/sitemap.ts 와 같다. 파비콘·로고·매니페스트
        // (public/ 의 브랜드 파일)도 뺀다 — 막혀 있으면 검색 결과에 아이콘이 뜨지 않는다.
        source: "/((?!privacy$|favicon|bolsaram-|site\\.webmanifest$).+)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, noimageindex" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
