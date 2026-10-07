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
  async headers() {
    return [
      {
        // 첫 화면(`/`)과 처리방침(`/privacy`)을 뺀 전부에 색인 금지를 건다.
        // 헤더와 메타가 다르면 구글은 엄격한 쪽을 따르므로 여기서 빼야 열린다.
        // 여는 목록은 app/robots.ts · app/sitemap.ts 와 같다.
        source: "/((?!privacy$).+)",
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
