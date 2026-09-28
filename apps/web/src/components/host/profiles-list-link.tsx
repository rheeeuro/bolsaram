"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

const KEY = "bolsaram.host.profilesList";

/**
 * 프로필 목록을 마지막으로 본 조건. 목록이 조건을 바꿀 때마다 부른다.
 *
 * 상세에서 「프로필」로 돌아가면 걸어 둔 조건(성별·나이·지역·검색어·보기)이 그대로
 * 살아 있어야 한다 — 조건을 다시 거는 일이 카카오톡방 스크롤과 다를 바 없어진다.
 * 같은 탭 안에서만 기억하면 되므로 sessionStorage 에 둔다.
 */
export function rememberProfilesList(query: string): void {
  try {
    window.sessionStorage.setItem(KEY, query);
  } catch {
    // 저장소를 막아 둔 브라우저에서는 조건 없는 목록으로 돌아갈 뿐이다.
  }
}

/** 마지막으로 본 조건의 프로필 목록으로 가는 링크. 기억이 없으면 `/profiles` 다. */
export function ProfilesListLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [href, setHref] = useState("/profiles");

  // 서버 렌더와 어긋나지 않게 mount 뒤에 읽는다.
  useEffect(() => {
    try {
      const query = window.sessionStorage.getItem(KEY);
      if (query) setHref(`/profiles?${query}`);
    } catch {
      // 위와 같다.
    }
  }, []);

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
