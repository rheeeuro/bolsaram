/**
 * 주선자 화면 목록과 그 아이콘 — 데스크톱 사이드바와 모바일 하단 탭이 함께 읽는다.
 *
 * 한 곳에 두는 이유는 두 내비게이션이 **같은 목적지를 다르게 그리기** 때문이다.
 * 모바일 하단 탭에는 다섯 칸까지 들어가므로 `primary` 로 앞쪽을 가르고 나머지는
 * 「더보기」 시트로 내려보낸다. 사이드바는 가르지 않고 전부 세로로 편다.
 *
 * **채팅은 이 목록에 없다.** 화면을 오가는 일이 아니라 하던 일 중에 들르는 곳이라
 * 오른쪽 아래 떠 있는 버튼(`HostChatFab`)이 맡는다. 아이콘은 그 버튼도 여기서
 * 가져가므로 `/chat` 갈래를 남겨 둔다.
 *
 * 아이콘은 멤버 하단 탭과 같은 얇은 선(1.3)으로 그린다 — 두 화면이 한 제품이다.
 */

export type HostLink = {
  href: string;
  label: string;
  /** 하위 경로를 활성으로 치지 않는 곳(`/home`)만 켠다. */
  exact?: boolean;
  /** 모바일 하단 탭에 직접 올라가는 것들. */
  primary?: boolean;
};

export const HOST_LINKS: HostLink[] = [
  { href: "/home", label: "홈", exact: true, primary: true },
  { href: "/profiles", label: "프로필", primary: true },
  { href: "/requests", label: "신청", primary: true },
  { href: "/imports", label: "가져오기" },
  { href: "/members", label: "멤버" },
];

export function isHostLinkActive(link: HostLink, pathname: string): boolean {
  return link.exact ? pathname === link.href : pathname.startsWith(link.href);
}

const SVG = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" } as const;

/** 경로로 고르는 아이콘. 「더보기」는 경로가 없어 `name="more"` 로 부른다. */
export function HostNavIcon({ name }: { name: string }) {
  switch (name) {
    case "/home":
      return (
        <svg {...SVG} aria-hidden>
          <path
            d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V8.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "/profiles":
      return (
        <svg {...SVG} aria-hidden>
          <rect
            x="3.5"
            y="3"
            width="13"
            height="14"
            rx="2.2"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <circle cx="10" cy="8.3" r="2.1" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M6.4 14.6c.6-1.7 1.9-2.6 3.6-2.6s3 .9 3.6 2.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "/requests":
      return (
        <svg {...SVG} aria-hidden>
          <path
            d="M3.5 7.3h9.7M10.9 5l2.4 2.3-2.4 2.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16.5 12.7H6.8M9.1 15l-2.4-2.3 2.4-2.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "/imports":
      return (
        <svg {...SVG} aria-hidden>
          <path
            d="M10 3v7.6m0 0 2.8-2.8M10 10.6 7.2 7.8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3.8 13v1.6A1.9 1.9 0 0 0 5.7 16.5h8.6a1.9 1.9 0 0 0 1.9-1.9V13"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "/members":
      return (
        <svg {...SVG} aria-hidden>
          <circle cx="7.8" cy="7.4" r="2.6" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M2.8 16.2c0-2.5 2.2-4 5-4s5 1.5 5 4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path
            d="M13.6 5.2a2.4 2.4 0 0 1 0 4.5M14.6 16.2c0-1.9-.6-3.1-1.7-3.8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "/chat":
      return (
        <svg {...SVG} aria-hidden>
          <path
            d="M4 6.2A1.7 1.7 0 0 1 5.7 4.5h8.6A1.7 1.7 0 0 1 16 6.2v5.3a1.7 1.7 0 0 1-1.7 1.7H8.9L5.6 16v-2.8H5.7A1.7 1.7 0 0 1 4 11.5V6.2Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...SVG} aria-hidden>
          <circle cx="4.6" cy="10" r="1.4" fill="currentColor" />
          <circle cx="10" cy="10" r="1.4" fill="currentColor" />
          <circle cx="15.4" cy="10" r="1.4" fill="currentColor" />
        </svg>
      );
  }
}
