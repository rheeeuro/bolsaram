"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { GROUP_MESSAGE_MENTION } from "@bolsaram/schemas";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";

/**
 * 채팅의 멤버 태그 — `@23` 처럼 `@` 뒤에 공개 번호를 붙인다.
 *
 * 쓰는 쪽: 입력란에서 `@` 를 치면 이 모임의 멤버 목록이 입력란 위에 뜨고, 번호를 더
 * 칠수록 좁혀진다. 고르면 `@23 ` 이 들어간다. 목록 없이 번호를 끝까지 쳐도 같다.
 *
 * 읽는 쪽: 본문의 태그는 그 프로필로 가는 링크가 된다. 어느 프로필인지는 서버가 RLS 를
 * 통과해 알려 준 것(`profileIds`)만 쓴다 — 볼 수 없는 번호는 글자로 남는다.
 *
 * 목록에도 이름은 없다. 방에서는 번호로만 부른다.
 */

export type MentionCandidate = {
  profileId: string;
  code: number;
  gender: string;
  birthYear: number;
  jobTitle: string | null;
  status: string;
  photoUrl: string | null;
};

/** 본문을 글자와 태그로 나눠 그린다. 태그는 볼 수 있는 번호일 때만 링크가 된다. */
export function MentionText({
  body,
  profileIds,
}: {
  body: string;
  profileIds: Record<string, string>;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of body.matchAll(GROUP_MESSAGE_MENTION)) {
    const start = match.index;
    const code = match[1]!;
    const profileId = profileIds[code];
    if (!profileId) continue;
    if (start > cursor) parts.push(body.slice(cursor, start));
    parts.push(
      <Link
        key={start}
        href={`/profiles/${profileId}`}
        className={cn(
          "rounded-md bg-[var(--color-rose-100)] px-1 py-px font-medium text-[var(--color-burgundy-700)]",
          "transition-colors hover:bg-[var(--color-rose-200)]",
        )}
      >
        <span className="sr-only">멤버 </span>@{code}번
      </Link>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return <>{parts}</>;
}

/** 커서 바로 앞이 태그를 쓰는 중인가. `@` 와 번호 앞자리(없어도 됨)까지를 찾는다. */
function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  const match = /(?<![\p{L}\p{N}_])@(\d{0,9})$/u.exec(value.slice(0, caret));
  return match ? { start: match.index, query: match[1]! } : null;
}

/**
 * 입력란에 붙는 태그 고르기.
 *
 * 입력란의 값·커서를 보고 목록을 열고 닫는다. 키보드(↑↓·Enter·Tab·Esc)는 목록이 열려
 * 있을 때만 가로챈다 — 그 밖의 Enter 는 원래대로 보내기다.
 */
export function useMentionPicker({
  groupId,
  value,
  setValue,
  inputRef,
}: {
  groupId: string;
  value: string;
  setValue: (next: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  /** Esc 로 닫은 자리. 같은 `@` 에서 다시 열지 않는다. */
  const dismissedRef = useRef<number | null>(null);

  /** 입력·커서 이동마다 부른다. */
  function sync() {
    const input = inputRef.current;
    if (!input) return;
    const next = mentionAt(input.value, input.selectionStart ?? input.value.length);
    if (!next || next.start === dismissedRef.current) {
      if (!next) dismissedRef.current = null;
      setMention(null);
      return;
    }
    setMention((prev) =>
      prev && prev.start === next.start && prev.query === next.query ? prev : next,
    );
  }

  const query = mention?.query ?? null;

  // 번호를 칠 때마다 묻는다. 빠르게 치는 동안은 기다렸다가 마지막 것만 묻는다.
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await apiGet<{ candidates: MentionCandidate[] }>(
        `/api/admin/groups/${groupId}/mentions?q=${query}`,
      );
      if (cancelled) return;
      setCandidates(result.ok ? result.data.candidates : []);
      setLoaded(true);
      setActive(0);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupId, query]);

  const open = mention !== null;

  function pick(candidate: MentionCandidate) {
    const input = inputRef.current;
    if (!mention || !input) return;
    const caret = input.selectionStart ?? value.length;
    const inserted = `@${candidate.code} `;
    // 커서 뒤에 이미 공백이 있으면 하나만 남긴다.
    const after = value.slice(caret).replace(/^ /, "");
    setValue(value.slice(0, mention.start) + inserted + after);
    setMention(null);
    const position = mention.start + inserted.length;
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(position, position);
    });
  }

  /** 목록이 처리했으면 true. 그때 입력란은 이 키를 더 쓰지 않는다. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      // 패널의 Esc(닫기)까지 가지 않게 여기서 멈춘다.
      event.preventDefault();
      event.stopPropagation();
      dismissedRef.current = mention.start;
      setMention(null);
      return true;
    }
    if (candidates.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + candidates.length) % candidates.length);
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      pick(candidates[Math.min(active, candidates.length - 1)]!);
      return true;
    }
    return false;
  }

  const list = open ? (
    <MentionList
      query={mention.query}
      candidates={candidates}
      loaded={loaded}
      active={active}
      onHover={setActive}
      onPick={pick}
    />
  ) : null;

  function close() {
    setMention(null);
  }

  return { sync, close, onKeyDown, list, open };
}

function MentionList({
  query,
  candidates,
  loaded,
  active,
  onHover,
  onPick,
}: {
  query: string;
  candidates: MentionCandidate[];
  loaded: boolean;
  active: number;
  onHover: (index: number) => void;
  onPick: (candidate: MentionCandidate) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  // 방향키로 고른 줄이 목록 밖에 있으면 그만큼만 스크롤해 보이게 한다. 목록 자신만
  // 움직인다 — `scrollIntoView` 는 패널과 뒤의 화면까지 끌고 간다.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[active];
    if (!list || !(item instanceof HTMLElement)) return;
    if (item.offsetTop < list.scrollTop) {
      list.scrollTop = item.offsetTop;
    } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [active, candidates]);

  return (
    <div
      className={cn(
        "animate-enter absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden",
        "rounded-2xl border border-[var(--surface-border)] bg-white shadow-[var(--shadow-lift)]",
      )}
    >
      <p className="border-b border-[var(--surface-border)] px-3.5 py-2 text-[11.5px] text-[var(--surface-text-muted)]">
        {query ? `번호 앞자리 ${query}` : "이 모임 멤버 — 번호를 이어 치면 좁혀집니다"}
      </p>
      {candidates.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-[var(--surface-text-muted)]">
          {loaded ? "이 모임에 맞는 번호가 없습니다." : "찾는 중…"}
        </p>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="태그할 멤버"
          className="relative max-h-64 overflow-y-auto py-1">
          {candidates.map((candidate, index) => {
            const facts = [
              label.gender(candidate.gender),
              label.birthYear(candidate.birthYear),
              candidate.jobTitle,
            ].filter(Boolean);
            const inactive = candidate.status !== "ACTIVE";
            return (
              <li key={candidate.profileId} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  // 누르는 동안 입력란의 포커스를 빼앗지 않는다. 고른 뒤 바로 이어 쓴다.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(candidate)}
                  onMouseEnter={() => onHover(index)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3.5 py-2 text-left",
                    index === active && "bg-[var(--surface-muted)]",
                  )}
                >
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-rose-100)] text-[11px] text-[var(--color-burgundy-700)]"
                  >
                    {candidate.photoUrl ? (
                      // 단기 signed URL 이라 next/image 의 캐시를 거치지 않는다.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={candidate.photoUrl} alt="" className="size-full object-cover" />
                    ) : (
                      label.gender(candidate.gender)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-[var(--surface-text)]">
                      {candidate.code}번
                      {inactive ? (
                        <span className="ml-1.5 text-[11.5px] font-normal text-[var(--surface-text-muted)]">
                          {label.profileStatus(candidate.status)}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--surface-text-muted)]">
                      {facts.join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
