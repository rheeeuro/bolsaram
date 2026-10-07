/**
 * 검색엔진 크롤링 범위.
 *
 * 첫 화면과 개인정보 처리방침만 연다. 사람 정보가 있는 화면은 전부 로그인 뒤에 있지만,
 * 크롤러가 받아 가지도 않게 나머지는 막는다. 구글은 가장 긴 규칙을 따르므로
 * `/$`·`/privacy$` 가 `Disallow: /` 를 이긴다. 정적 파일은 화면 렌더와 파비콘에 필요하다.
 *
 * 여는 페이지 목록은 page 메타의 robots · sitemap.ts · next.config.ts 의 X-Robots-Tag 와 같다.
 */
import type { MetadataRoute } from "next";
import { env } from "@/server/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/$",
        "/privacy$",
        "/_next/static/",
        "/_next/image",
        "/favicon",
        "/bolsaram-",
        "/site.webmanifest",
      ],
      disallow: "/",
    },
    sitemap: `${env().APP_ORIGIN}/sitemap.xml`,
  };
}
