"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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

  const images = profile.images.length > 0 ? profile.images : [];
  const current = images[imageIndex];

  return (
    <main className="pb-8">
      {/* 큰 인물 사진 (UI 컨셉 04).
          모바일은 화면을 꽉 채우고, 데스크톱은 본문 폭보다 좁은 세로 카드로 둔다 —
          전체폭을 유지하면 넓은 화면에서 사진만 한 화면을 다 먹는다. */}
      <div className="relative mx-auto aspect-4/5 w-full overflow-hidden bg-[var(--color-ivory-200)] sm:mt-6 sm:max-w-[400px] sm:rounded-[var(--radius-card)]">
        {current ? (
          // signed URL 은 단기 만료된다. next/image 캐싱을 피한다.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt="" className="h-full w-full object-cover" />
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
            <div className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[12px] text-white">
              {imageIndex + 1}/{images.length}
            </div>
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  aria-label={`${index + 1}번째 사진`}
                  onClick={() => setImageIndex(index)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-[var(--duration-quick)]",
                    index === imageIndex ? "w-5 bg-white" : "w-1.5 bg-white/55",
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="mx-auto max-w-2xl px-5">
        <header className="pt-6">
          <h1 className="display text-[30px] leading-none text-[var(--color-ink-900)]">
            {profile.code}
          </h1>
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

      {/* 액션 바 */}
      {isSelf ? (
        <p className="mx-auto mt-10 max-w-2xl px-5 text-[13px] text-[var(--color-ink-600)]">
          내 프로필입니다. 수정이 필요하면 주선자에게 알려주세요.
        </p>
      ) : (
        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 mt-10 border-t border-[var(--surface-border)] bg-white/95 px-5 py-3 backdrop-blur">
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

      {/* 숨기기는 프로필이 연결된 회원만 할 수 있다. 연결된 상대는 새로 숨기지 않는다 —
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
  if (existing) {
    const text =
      existing.status === "REQUESTED"
        ? existing.isRequester
          ? "신청 대기 중"
          : "받은 신청 확인"
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
