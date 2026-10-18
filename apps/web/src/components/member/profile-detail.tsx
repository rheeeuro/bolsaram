"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { AiRecommendBadge, HashtagChip, ProfileCode } from "@/components/ui/marks";
import { apiDelete, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";
import type { ProfileDetailView } from "@/server/views/profile-view";
import { RequestModal } from "./request-modal";
import { MatchMoment, type MomentVariant } from "./match-moment";
import { HideAction } from "./hide-action";

type Existing = { status: string; isRequester: boolean } | null;

/**
 * 신청을 막는 관계 (마이그레이션 0023).
 *
 * `hiddenBetween` 은 방향을 담지 않는다 — 상대가 나를 숨겼다는 사실을 화면에 흘리지
 * 않기 위해서다. 내가 숨겼는지는 `iHid` 로만 알 수 있고 그때만 해제 버튼이 뜬다.
 */
type Relation = {
  rejected: boolean;
  hiddenBetween: boolean;
  iHid: boolean;
  /** 이 사람에게 보낸 마음이 아직 주선자 확인을 기다리는 중인가 (0026). */
  pendingSend: boolean;
};

export function ProfileDetail({
  profile,
  isSelf,
  canRequest,
  existing,
  relation,
  backHref,
}: {
  profile: ProfileDetailView;
  isSelf: boolean;
  canRequest: boolean;
  existing: Existing;
  relation: Relation;
  backHref: string;
}) {
  const router = useRouter();
  const [imageIndex, setImageIndex] = useState(0);
  const [favorited, setFavorited] = useState(profile.isFavorited);
  const [modalOpen, setModalOpen] = useState(false);
  // 마음 보내기는 주선자를 거친다 — 대행 중일 때만 그 자리에서 전달된다(0026).
  const [moment, setMoment] = useState<MomentVariant | null>(null);

  const images = profile.images;
  const trackRef = useRef<HTMLDivElement>(null);

  // 화살표·점·탭은 스크롤만 옮긴다. 현재 장 표시는 onScroll 이 맞춘다.
  function goTo(index: number) {
    const el = trackRef.current;
    if (!el || index < 0 || index >= images.length) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }

  return (
    <main className={isSelf ? "pb-8" : undefined}>
      {/* 큰 인물 사진 (UI 컨셉 04).
          모바일은 화면을 꽉 채우고, 데스크톱은 본문 폭보다 좁은 세로 카드로 둔다 —
          전체폭을 유지하면 넓은 화면에서 사진만 한 화면을 다 먹는다. */}
      <div className="relative mx-auto w-full sm:mt-6 sm:max-w-[400px]">
        <div className="relative aspect-4/5 w-full overflow-hidden bg-[var(--color-ivory-200)] sm:rounded-[var(--radius-card)]">
          {images.length > 0 ? (
            // 가로 스냅 스크롤이라 손가락·트랙패드로 넘긴다. 현재 장은 스크롤 위치에서 읽는다.
            // 사진을 누르면 누른 쪽으로 한 장 넘긴다 — 사진 위에 버튼을 얹지 않기 위해서다.
            // 밀어서 넘긴 경우에는 브라우저가 click 을 보내지 않는다.
            <div
              ref={trackRef}
              onClick={(event) => {
                if (images.length < 2) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const leftSide = event.clientX - rect.left < rect.width / 2;
                goTo(imageIndex + (leftSide ? -1 : 1));
              }}
              onScroll={(event) => {
                const el = event.currentTarget;
                const next = Math.round(el.scrollLeft / el.clientWidth);
                if (next !== imageIndex) setImageIndex(next);
              }}
              tabIndex={images.length > 1 ? 0 : -1}
              aria-label="프로필 사진"
              className={cn(
                "no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain outline-none",
                images.length > 1 && "cursor-pointer",
              )}
            >
              {images.map((image) => (
                // signed URL 은 단기 만료된다. next/image 캐싱을 피한다.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={image.url}
                  alt=""
                  draggable={false}
                  className="h-full w-full shrink-0 snap-center snap-always object-cover"
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-ink-500)]">
              사진 준비 중
            </div>
          )}

          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: "linear-gradient(to bottom, rgb(0 0 0 / 0.28), transparent)" }}
          />

          <Link
            href={backHref}
            aria-label="뒤로"
            className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/85 backdrop-blur"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M12 4 6 10l6 6"
                stroke="var(--color-ink-900)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>

          {images.length > 1 ? (
            <>
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[12px] text-white">
                {imageIndex + 1}/{images.length}
              </div>
              {/* 점은 작게 보이되 누르는 영역은 넉넉하게 둔다. */}
              <div className="absolute inset-x-0 bottom-1.5 flex justify-center">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    aria-label={`${index + 1}번째 사진`}
                    aria-current={index === imageIndex}
                    onClick={() => goTo(index)}
                    className="grid h-7 place-items-center px-1"
                  >
                    <span
                      className={cn(
                        "block h-1.5 rounded-full shadow-[0_0_2px_rgb(0_0_0/0.35)] transition-all duration-[var(--duration-quick)]",
                        index === imageIndex ? "w-5 bg-white" : "w-1.5 bg-white/60",
                      )}
                    />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* 데스크톱 화살표는 사진 밖 여백에 둔다. 사진을 가리지 않고, 사진 위의 뒤로가기와
          섞이지 않는다. 폰에서는 밀거나 눌러서 넘긴다. */}
        {images.length > 1 ? (
          <>
            <PhotoArrow
              direction="prev"
              disabled={imageIndex === 0}
              onClick={() => goTo(imageIndex - 1)}
            />
            <PhotoArrow
              direction="next"
              disabled={imageIndex === images.length - 1}
              onClick={() => goTo(imageIndex + 1)}
            />
          </>
        ) : null}
      </div>

      <div className="mx-auto max-w-2xl px-5">
        <header className="pt-6">
          <h1 className="display text-[30px] leading-none text-[var(--color-ink-900)]">
            <ProfileCode code={profile.code} />
          </h1>
          {profile.aiMatch ? <AiMatchLine match={profile.aiMatch} /> : null}
          {profile.realName ? (
            <p className="mt-2 text-[15px] text-[var(--color-burgundy-700)]">
              {profile.realName}
            </p>
          ) : null}
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13.5px] text-[var(--color-ink-700)]">
            <span>{profile.birthYear}년생</span>
            {profile.height ? <span>{profile.height}cm</span> : null}
            <span>{label.region(profile.residenceRegion)}</span>
          </p>
        </header>

        {/* 주선자가 직접 쓴 한마디. 본인 소개와 섞이지 않게 맨 위에 따로 둔다. */}
        {profile.hostComment ? (
          <Section title="주선자 코멘트">
            <blockquote className="rounded-xl border-l-2 border-[var(--color-rose-300)] bg-[var(--color-rose-100)]/60 px-4 py-3.5">
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--color-ink-800)]">
                {profile.hostComment}
              </p>
            </blockquote>
          </Section>
        ) : null}

        <Section title="ABOUT">
          <Rows
            rows={[
              [
                "직업",
                [profile.jobTitle, label.jobCategory(profile.jobCategory)]
                  .filter(Boolean)
                  .join(" · "),
              ],
              ["회사", profile.company],
              ["학력", profile.education],
              ["직장 지역", label.region(profile.workplaceRegion)],
              ["종교", label.religion(profile.religion)],
              ["MBTI", profile.mbti],
              ["흡연", label.smoking(profile.smoking)],
              ["음주", label.drinking(profile.drinking)],
            ]}
          />
        </Section>

        {profile.hashtags.length > 0 ? (
          <Section title="해시태그">
            {/* 태그를 누르면 같은 태그를 가진 사람만 모아 본다. */}
            <div className="flex flex-wrap gap-1.5">
              {profile.hashtags.map((tag) => (
                <HashtagChip
                  key={tag}
                  tag={tag}
                  href={`/discover?tags=${encodeURIComponent(tag)}`}
                />
              ))}
            </div>
          </Section>
        ) : null}

        {profile.hobbies.length > 0 ? (
          <Section title="취미">
            <div className="flex flex-wrap gap-1.5">
              {profile.hobbies.map((hobby) => (
                <span
                  key={hobby}
                  className="rounded-full border border-[var(--surface-border)] px-3 py-1 text-[13px] text-[var(--color-ink-700)]"
                >
                  {hobby}
                </span>
              ))}
            </div>
          </Section>
        ) : null}

        {profile.bio ? (
          <Section title="자기소개">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--color-ink-800)]">
              {profile.bio}
            </p>
          </Section>
        ) : null}

        {profile.idealTypeText ? (
          <Section title="IDEAL TYPE">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--color-ink-800)]">
              {profile.idealTypeText}
            </p>
          </Section>
        ) : null}

        {profile.contactNote ? (
          <Section title="연락 방법">
            <p className="rounded-xl bg-[var(--color-rose-100)] px-4 py-3 text-[14px] text-[var(--color-burgundy-800)]">
              {profile.contactNote}
            </p>
          </Section>
        ) : null}
      </div>

      {/* 액션 바보다 먼저 둔다 — 바가 본문의 마지막이어야 끝까지 내렸을 때 하단 탭에 붙는다.
          숨기기는 프로필이 연결된 멤버만 할 수 있다. 연결된 상대는 새로 숨기지 않는다 —
          연락처를 이미 주고받은 뒤라 화면에서 지우는 것으로 해결되지 않는다.
          **이미 숨긴 상대는 상태와 무관하게 해제할 수 있어야 한다** — 해제 버튼을
          상태로 가리면 되돌릴 수 없는 숨김이 남는다. */}
      {!isSelf && canRequest && (relation.iHid || existing?.status !== "INTRODUCED") ? (
        <HideAction
          profileId={profile.id}
          code={profile.code}
          hidden={relation.iHid}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {/* 액션 바 */}
      {isSelf ? (
        <p className="mx-auto mt-10 max-w-2xl px-5 text-[13px] text-[var(--color-ink-600)]">
          내 프로필입니다. 수정이 필요하면 주선자에게 알려주세요.
        </p>
      ) : (
        <div className="sticky bottom-[var(--member-bottom)] z-20 mt-10 border-t border-[var(--surface-border)] bg-white/95 px-5 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => {
                const next = !favorited;
                setFavorited(next);
                void (
                  next
                    ? apiPost("/api/favorites", { profileId: profile.id })
                    : apiDelete("/api/favorites", { profileId: profile.id })
                ).then((r) => {
                  if (!r.ok) setFavorited(!next);
                });
              }}
            >
              {favorited ? "관심 저장됨" : "관심 담기"}
            </Button>

            <RequestAction
              existing={existing}
              canRequest={canRequest}
              relation={relation}
              onOpen={() => setModalOpen(true)}
            />
          </div>
        </div>
      )}

      <RequestModal
        open={modalOpen}
        code={profile.code}
        onClose={() => setModalOpen(false)}
        onSent={(pending) => {
          setModalOpen(false);
          setMoment(pending ? "requestPending" : "sent");
        }}
        profileId={profile.id}
      />

      <MatchMoment
        open={moment != null}
        {...(moment ? { variant: moment } : {})}
        onClose={() => {
          setMoment(null);
          router.refresh();
        }}
      />
    </main>
  );
}

function RequestAction({
  existing,
  canRequest,
  relation,
  onOpen,
}: {
  existing: Existing;
  canRequest: boolean;
  relation: Relation;
  onOpen: () => void;
}) {
  // 받은 신청에 답하는 곳은 시그널 받은 탭이다. 여기서 막다른 버튼으로 두지 않는다.
  if (existing?.status === "REQUESTED" && !existing.isRequester) {
    return (
      <Link
        href="/signals?tab=incoming"
        className={buttonClasses({ size: "lg", className: "flex-[1.4]" })}
      >
        받은 신청에 답하기
      </Link>
    );
  }
  if (existing) {
    const text =
      existing.status === "REQUESTED"
        ? "신청 대기 중"
        : "연결됨";
    return (
      <Button variant="secondary" size="lg" className="flex-[1.4]" disabled>
        {text}
      </Button>
    );
  }
  if (!canRequest) {
    return (
      <Button variant="secondary" size="lg" className="flex-[1.4]" disabled>
        프로필 연결 후 가능
      </Button>
    );
  }
  // 이미 낸 요청이 확인을 기다리는 중이면 다시 누를 것이 없다. 누르면 DB 의 부분
  // 유니크 인덱스가 막아 오류 문구만 보게 된다.
  if (relation.pendingSend) {
    return (
      <Button variant="secondary" size="lg" className="flex-[1.4]" disabled>
        주선자 확인 중
      </Button>
    );
  }
  // 거절과 숨김에 **같은 문구**를 쓴다. 문구가 갈리면 자기가 거절한 사실을 아는
  // 사람이 「거절」이 아닌 답을 보는 것만으로 상대가 숨겼음을 추론할 수 있다.
  if (relation.hiddenBetween || relation.rejected) {
    return (
      <Button variant="secondary" size="lg" className="flex-[1.4]" disabled>
        지금은 보낼 수 없어요
      </Button>
    );
  }
  return (
    <Button size="lg" className="flex-[1.4]" onClick={onOpen}>
      소개 신청하기
    </Button>
  );
}

function PhotoArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "이전 사진" : "다음 사진"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[var(--surface-border)] bg-white text-[var(--color-ink-700)] transition-opacity hover:bg-[var(--color-ivory-100)] disabled:pointer-events-none disabled:opacity-0 sm:grid",
        direction === "prev" ? "-left-16" : "-right-16",
      )}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d={direction === "prev" ? "M12 4 6 10l6 6" : "M8 4l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="kicker mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string | null | undefined][] }) {
  const visible = rows.filter(([, value]) => value != null && value !== "");
  if (visible.length === 0) {
    return <p className="text-[13px] text-[var(--color-ink-500)]">등록된 정보가 없습니다.</p>;
  }
  return (
    <dl className="grid grid-cols-[80px_1fr] gap-x-4 gap-y-2.5">
      {visible.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-[13px] text-[var(--color-ink-500)]">{key}</dt>
          <dd className="text-[13.5px] text-[var(--color-ink-800)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * AI 추천 이유 한 줄. 이상형 조건을 모두 만족했는지, 공통점이 많아서인지를 가른다.
 * 공통점은 둘 다 이미 볼 수 있는 값(내 태그·상대 태그·종교)이라 그대로 보여 준다.
 */
function AiMatchLine({ match }: { match: NonNullable<ProfileDetailView["aiMatch"]> }) {
  const common = [
    ...match.commonTags.map((tag) => `#${tag}`),
    ...(match.commonReligion ? [`같은 종교(${label.religion(match.commonReligion)})`] : []),
  ];
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      <p className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-600)]">
        <AiRecommendBadge />
        {match.ideal ? "내 이상형 조건과 잘 맞는 분이에요" : "나와 공통점이 많은 분이에요"}
      </p>
      {common.length > 0 ? (
        <p className="text-[12px] text-[var(--color-ink-600)]">
          <span className="text-[var(--color-ink-500)]">공통점</span> {common.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
