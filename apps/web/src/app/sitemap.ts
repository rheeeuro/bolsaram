/**
 * 검색에 노출하는 페이지 목록 — robots.ts 가 여는 두 화면과 같다.
 */
import type { MetadataRoute } from "next";
import { env } from "@/server/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = env().APP_ORIGIN;
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/privacy`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
