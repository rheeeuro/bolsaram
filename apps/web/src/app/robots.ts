/**
 * 검색엔진 색인 금지 (설계문서 §12).
 * 루트 레이아웃의 robots 메타와 같은 약속을 크롤러가 페이지를 받기 전에 알려준다.
 */
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
