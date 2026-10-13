"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { GROUP_MESSAGE_MEMBER_TAG } from "@bolsaram/schemas";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";

/**
 * 채팅의 멘션 — 두 가지다.
 *
 *   `@이름`  이 모임의 주선자. 누구를 부르는지 눈에 띄게 남긴다. 나를 부른 멘션은 더 진하다.
 *   `#23`    이 모임의 멤버(공개 번호). 그 프로필로 가는 링크가 된다.
 *
 * 쓰는 쪽: 입력란에서 `@` 나 `#` 를 치면 그 목록이 입력란 위에 뜨고, 이어 칠수록
 * 좁혀진다. 고르면 `@김하늘 ` · `#23 ` 이 들어간다. 목록 없이 끝까지 쳐도 같다.
 *
 * 읽는 쪽: 누구를 가리키는지는 서버가 RLS 를 통과해 알려 준 것(`hostIds` ·
 * `profileIds`)만 쓴다 — 볼 수 없는 번호나 지금 모임에 없는 이름은 글자로 남는다.
 *
 * 멤버 목록에도 이름은 없다. 방에서 멤버는 번호로만 부른다.
 */

type Kind = "host" | "member";

type HostCandidate = { userId: string; name: string; isOwner: boolean; avatarUrl: string | null };

type MemberCandidate = {
  profileId: string;
  code: number;
  gender: string;
  birthYear: number;
  jobTitle: string | null;
  status: string;
  photoUrl: string | null;
};

/** 목록 한 줄. 두 종류를 같은 모양으로 그린다. */
type Option = {
  key: string;
  title: string;
  note: string | null;
  detail: string | null;
  imageUrl: string | null;
  /** 사진이 없을 때 동그라미 안에 넣는 글자. */
  fallback: string;
  /** 고르면 입력란에 들어가는 글. */
  insert: string;
};

function hostOption(host: HostCandidate): Option {
  return {
    key: host.userId,
    title: host.name,
    note: host.isOwner ? "모임장" : null,
    detail: null,
    imageUrl: host.avatarUrl,
    fallback: host.name.slice(0, 1),
    insert: `@${host.name}`,
  };
}

function memberOption(member: MemberCandidate): Option {
  return {
    key: member.profileId,
    title: `${member.code}번`,
    note: member.status === "ACTIVE" ? null : label.profileStatus(member.status),
    detail: [label.gender(member.gender), label.birthYear(member.birthYear), member.jobTitle]
      .filter(Boolean)
      .join(" · "),
    imageUrl: member.photoUrl,
    fallback: label.gender(member.gender) ?? "",
    insert: `#${member.code}`,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 멘션의 색. 입력창과 메시지 창이 같은 색을 쓴다 — 쓰는 동안 본 모양이 보낸 뒤에도 같다.
 *
 *   멤버   로즈 — 프로필로 가는 링크다
 *   주선자 파랑 — 사람을 부른 것이다. 나를 부른 것은 진하게 채운다
 *
 * 글자 굵기와 안쪽 여백은 여기 넣지 않는다. 입력창 뒤에 겹쳐 그리는 층은 글자 폭이 입력창과
 * 한 치도 다르지 않아야 커서가 맞는다. 메시지 창의 칩만 `CHIP` 으로 여백을 더한다.
 */
export const MENTION_COLORS = {
  member: "bg-[var(--color-rose-100)] text-[var(--color-burgundy-700)]",
  host: "bg-[color-mix(in_srgb,var(--color-info)_14%,white)] text-[var(--color-info)]",
  hostMine: "bg-[var(--color-info)] text-white",
} as const;

const CHIP = "rounded-md px-1 py-px font-medium";

type MentionPart =
  | { kind: "text"; text: string }
  | { kind: "member"; text: string; code: string }
  | { kind: "host"; text: string; name: string };

/**
 * 본문을 글자와 멘션으로 나눈다.
 *
 *   isMember   이 번호를 멘션으로 칠 것인가. 메시지 창은 서버가 풀어 준 번호만,
 *              입력창은 모양만 맞으면 친다(보내기 전에는 누구인지 모른다).
 *   hostNames  이 방 주선자 이름. 이름은 정해진 모양이 없어서 아는 이름만 찾는다 —
 *              「김하」와 「김하늘」이 함께 있으면 긴 쪽을 먼저 맞춘다.
 */
export function splitMentions(
  body: string,
  isMember: (code: string) => boolean,
  hostNames: string[],
): MentionPart[] {
  type Hit = { start: number; end: number; part: MentionPart };
  const hits: Hit[] = [];

  for (const match of body.matchAll(GROUP_MESSAGE_MEMBER_TAG)) {
    const code = match[1]!;
    if (!isMember(code)) continue;
    const text = match[0];
    hits.push({ start: match.index, end: match.index + text.length, part: { kind: "member", text, code } });
  }

  const names = hostNames.filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length > 0) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])@(${names.map(escapeRegExp).join("|")})`, "gu");
    for (const match of body.matchAll(pattern)) {
      const text = match[0];
      hits.push({
        start: match.index,
        end: match.index + text.length,
        part: { kind: "host", text, name: match[1]! },
      });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  const parts: MentionPart[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) parts.push({ kind: "text", text: body.slice(cursor, hit.start) });
    parts.push(hit.part);
    cursor = hit.end;
  }
  if (cursor < body.length) parts.push({ kind: "text", text: body.slice(cursor) });
  return parts;
}

/** 보낸 글의 본문. 서버가 풀어 준 멘션만 칩이 되고, 멤버 칩은 그 프로필로 간다. */
export function MentionText({
  body,
  profileIds,
  hostIds,
  viewerId,
}: {
  body: string;
  profileIds: Record<string, string>;
  hostIds: Record<string, string>;
  viewerId: string;
}) {
  const parts = splitMentions(body, (code) => code in profileIds, Object.keys(hostIds));
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "member") {
          return (
            <Link
              key={index}
              href={`/profiles/${profileIds[part.code]}`}
              title={`${part.code}번 프로필 열기`}
              className={cn(
                CHIP,
                MENTION_COLORS.member,
                "underline decoration-[var(--color-rose-300)] decoration-1 underline-offset-[3px]",
                "transition-colors hover:bg-[var(--color-rose-200)]",
              )}
            >
              <span className="sr-only">멤버 </span>#{part.code}번
            </Link>
          );
        }
        if (part.kind === "host") {
          const mine = hostIds[part.name] === viewerId;
          return (
            <span
              key={index}
              className={cn(CHIP, mine ? MENTION_COLORS.hostMine : MENTION_COLORS.host)}
            >
              <span className="sr-only">{mine ? "나를 부름 " : "주선자 "}</span>
              {part.text}
            </span>
          );
        }
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

/**
 * 입력창 뒤에 겹쳐 그리는 층. `textarea` 는 글자 일부에 색을 줄 수 없으므로, 입력창의 글자를
 * 투명하게 두고 같은 글을 이 층에 그려 멘션에만 색을 입힌다. 커서와 선택은 입력창 것이다.
 *
 * 글꼴·줄 간격·줄바꿈이 입력창과 같아야 한다. 마지막 줄바꿈 뒤의 빈 줄도 높이를 차지하도록
 * 끝에 폭 없는 공백을 붙인다.
 */
export function MentionInputMirror({
  value,
  hostNames,
  className,
  mirrorRef,
}: {
  value: string;
  hostNames: string[];
  className?: string;
  mirrorRef?: RefObject<HTMLDivElement | null>;
}) {
  const parts = splitMentions(value, () => true, hostNames);
  return (
    <div
      ref={mirrorRef}
      aria-hidden
      className={cn("pointer-events-none overflow-hidden whitespace-pre-wrap break-words", className)}
    >
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <mark
            key={index}
            className={cn(
              "rounded-[3px] [box-decoration-break:clone]",
              part.kind === "member" ? MENTION_COLORS.member : MENTION_COLORS.host,
            )}
          >
            {part.text}
          </mark>
        ),
      )}
      {"\u200b"}
    </div>
  );
}

type Typing = { kind: Kind; start: number; query: string };

/**
 * 커서 바로 앞이 멘션을 쓰는 중인가. `@` 뒤로는 공백 전까지의 이름 앞자리,
 * `#` 뒤로는 번호 앞자리(없어도 됨)를 본다.
 */
function typingAt(value: string, caret: number): Typing | null {
  const before = value.slice(0, caret);
  const member = /(?<![\p{L}\p{N}_])#(\d{0,9})$/u.exec(before);
  if (member) return { kind: "member", start: member.index, query: member[1]! };
  const host = /(?<![\p{L}\p{N}_])@([^\s@#]{0,40})$/u.exec(before);
  if (host) return { kind: "host", start: host.index, query: host[1]! };
  return null;
}

/**
 * 입력란에 붙는 멘션 고르기.
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
  const [typing, setTyping] = useState<Typing | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  /** Esc 로 닫은 자리. 같은 `@`·`#` 에서 다시 열지 않는다. */
  const dismissedRef = useRef<number | null>(null);
  /** 이 방 주선자 이름(나 제외). 입력창이 `@이름` 을 알아보고 색을 입히는 데 쓴다. */
  const [hostNames, setHostNames] = useState<string[]>([]);
  /** 고른 멘션 바로 뒤. 값이 화면에 반영되는 그 순간 커서를 옮긴다. */
  const caretRef = useRef<number | null>(null);

  // 값이 바뀐 직후, 다음 키 입력보다 먼저 커서를 멘션 뒤로 옮긴다. 한 프레임 미루면
  // 그 사이 친 글자가 커서가 끝으로 튄 자리에 들어가 순서가 뒤섞인다.
  useLayoutEffect(() => {
    const position = caretRef.current;
    const input = inputRef.current;
    if (position === null || !input) return;
    caretRef.current = null;
    input.focus();
    input.setSelectionRange(position, position);
  }, [value, inputRef]);

  /** 입력·커서 이동마다 부른다. */
  function sync() {
    const input = inputRef.current;
    if (!input) return;
    const next = typingAt(input.value, input.selectionStart ?? input.value.length);
    if (!next || next.start === dismissedRef.current) {
      if (!next) dismissedRef.current = null;
      setTyping(null);
      return;
    }
    setTyping((prev) =>
      prev && prev.kind === next.kind && prev.start === next.start && prev.query === next.query
        ? prev
        : next,
    );
  }

  const kind = typing?.kind ?? null;
  const query = typing?.query ?? null;

  // 방을 열 때 주선자 명단을 한 번 받아 둔다. 실패하면 입력창에서 `@이름` 에 색이 빠질 뿐이다.
  useEffect(() => {
    let cancelled = false;
    void apiGet<{ hosts: HostCandidate[] }>(`/api/admin/groups/${groupId}/mentions?kind=host`).then(
      (result) => {
        if (!cancelled && result.ok) setHostNames(result.data.hosts.map((host) => host.name));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // 종류가 바뀌면 앞 종류의 목록을 보여주지 않는다.
  useEffect(() => {
    setOptions([]);
    setLoaded(false);
  }, [kind]);

  // 칠 때마다 묻는다. 빠르게 치는 동안은 기다렸다가 마지막 것만 묻는다.
  useEffect(() => {
    if (kind === null || query === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const path = `/api/admin/groups/${groupId}/mentions?kind=${kind}&q=${encodeURIComponent(query)}`;
      const next =
        kind === "host"
          ? await apiGet<{ hosts: HostCandidate[] }>(path).then((r) =>
              r.ok ? r.data.hosts.map(hostOption) : [],
            )
          : await apiGet<{ candidates: MemberCandidate[] }>(path).then((r) =>
              r.ok ? r.data.candidates.map(memberOption) : [],
            );
      if (cancelled) return;
      setOptions(next);
      setLoaded(true);
      setActive(0);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupId, kind, query]);

  const open = typing !== null;

  function pick(option: Option) {
    const input = inputRef.current;
    if (!typing || !input) return;
    const caret = input.selectionStart ?? value.length;
    const inserted = `${option.insert} `;
    // 커서 뒤에 이미 공백이 있으면 하나만 남긴다.
    const after = value.slice(caret).replace(/^ /, "");
    caretRef.current = typing.start + inserted.length;
    setValue(value.slice(0, typing.start) + inserted + after);
    setTyping(null);
  }

  /** 목록이 처리했으면 true. 그때 입력란은 이 키를 더 쓰지 않는다. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!typing || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      // 패널의 Esc(닫기)까지 가지 않게 여기서 멈춘다.
      event.preventDefault();
      event.stopPropagation();
      dismissedRef.current = typing.start;
      setTyping(null);
      return true;
    }
    if (options.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      pick(options[Math.min(active, options.length - 1)]!);
      return true;
    }
    return false;
  }

  function close() {
    setTyping(null);
  }

  const list = typing ? (
    <MentionList
      kind={typing.kind}
      query={typing.query}
      options={options}
      loaded={loaded}
      active={active}
      onHover={setActive}
      onPick={pick}
    />
  ) : null;

  return { sync, close, onKeyDown, list, open, hostNames };
}

const LIST_COPY: Record<
  Kind,
  { label: string; hint: string; filtered: (q: string) => string; empty: string }
> = {
  host: {
    label: "멘션할 주선자",
    hint: "이 모임 주선자 — 이름을 이어 치면 좁혀집니다",
    filtered: (q) => `이름 앞자리 ${q}`,
    empty: "이 모임에 맞는 주선자가 없습니다.",
  },
  member: {
    label: "멘션할 멤버",
    hint: "이 모임 멤버 — 번호를 이어 치면 좁혀집니다",
    filtered: (q) => `번호 앞자리 ${q}`,
    empty: "이 모임에 맞는 번호가 없습니다.",
  },
};

function MentionList({
  kind,
  query,
  options,
  loaded,
  active,
  onHover,
  onPick,
}: {
  kind: Kind;
  query: string;
  options: Option[];
  loaded: boolean;
  active: number;
  onHover: (index: number) => void;
  onPick: (option: Option) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const copy = LIST_COPY[kind];

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
  }, [active, options]);

  return (
    <div
      className={cn(
        "animate-enter absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden",
        "rounded-2xl border border-[var(--surface-border)] bg-white shadow-[var(--shadow-lift)]",
      )}
    >
      <p className="border-b border-[var(--surface-border)] px-3.5 py-2 text-[11.5px] text-[var(--surface-text-muted)]">
        {query ? copy.filtered(query) : copy.hint}
      </p>
      {options.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-[var(--surface-text-muted)]">
          {loaded ? copy.empty : "찾는 중…"}
        </p>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={copy.label}
          className="relative max-h-64 overflow-y-auto py-1"
        >
          {options.map((option, index) => (
            <li key={option.key} role="option" aria-selected={index === active}>
              <button
                type="button"
                // 누르는 동안 입력란의 포커스를 빼앗지 않는다. 고른 뒤 바로 이어 쓴다.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(option)}
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
                  {option.imageUrl ? (
                    // 단기 signed URL 이라 next/image 의 캐시를 거치지 않는다.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={option.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    option.fallback
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[var(--surface-text)]">
                    {option.title}
                    {option.note ? (
                      <span className="ml-1.5 text-[11.5px] font-normal text-[var(--surface-text-muted)]">
                        {option.note}
                      </span>
                    ) : null}
                  </span>
                  {option.detail ? (
                    <span className="block truncate text-[12px] text-[var(--surface-text-muted)]">
                      {option.detail}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
