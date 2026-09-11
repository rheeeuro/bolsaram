import { Badge, toneForStatus } from "@/components/ui/badge";
import { Panel } from "@/components/host/surface";
import { label } from "@/lib/labels";
import type { ProfileDetailView } from "@/server/views/profile-view";

/**
 * 담당이 아닌 프로필의 상세.
 *
 * 전체공개 풀은 모든 주선자가 보지만 고치는 것은 등록한 사람뿐이다(0011). 그래서
 * 편집 폼·공개 전환·초대를 두지 않고 회원에게 소개하는 데 필요한 것만 보여준다.
 * 이름과 연락처는 공개 단계가 허락할 때만 `profile` 에 들어온다 — 여기서 다시
 * 판정하지 않는다.
 */
export function HostProfileReadonly({
  profile,
  status,
}: {
  profile: ProfileDetailView;
  status: string;
}) {
  const summary = [
    label.gender(profile.gender),
    `${profile.birthYear}년생`,
    profile.height ? `${profile.height}cm` : null,
    profile.jobTitle ?? label.jobCategory(profile.jobCategory),
    label.region(profile.residenceRegion),
  ]
    .filter(Boolean)
    .join(" · ");

  const facts: [string, string | null][] = [
    ["직업", profile.jobTitle],
    ["직업군", profile.jobCategory ? label.jobCategory(profile.jobCategory) : null],
    ["회사", profile.company],
    ["학력", profile.education],
    ["직장 지역", profile.workplaceRegion ? label.region(profile.workplaceRegion) : null],
    ["종교", profile.religion ? label.religion(profile.religion) : null],
    ["MBTI", profile.mbti],
    ["흡연", profile.smoking ? label.smoking(profile.smoking) : null],
    ["음주", profile.drinking ? label.drinking(profile.drinking) : null],
    ["취미", profile.hobbies.length > 0 ? profile.hobbies.join(", ") : null],
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3 text-[13px] text-[var(--surface-text-muted)]">
        다른 주선자가 등록한 분입니다. 내용을 고치거나 초대를 보낼 수는 없습니다.
      </p>

      <section className="flex flex-wrap items-center gap-5 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)]">
        <div className="h-32 w-24 shrink-0 overflow-hidden rounded-[12px] bg-[var(--color-ivory-200)]">
          {profile.images[0] ? (
            // signed URL 은 응답마다 새로 발급된다. next/image 최적화를 태우면 URL 이
            // 캐시되어 만료 뒤 깨지므로 img 를 그대로 쓴다.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.images[0].url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-[11.5px] text-[var(--color-ink-700)]">
              사진 없음
            </div>
          )}
        </div>

        <div className="min-w-48 flex-1">
          <h1 className="display text-[28px] leading-none text-[var(--color-ink-900)]">
            {profile.code}
          </h1>
          <p className="mt-2.5 text-[13.5px] text-[var(--surface-text-muted)]">{summary}</p>
          <div className="mt-3">
            <Badge tone={toneForStatus(status)}>{label.profileStatus(status)}</Badge>
          </div>
        </div>
      </section>

      {profile.images.length > 1 ? (
        <Panel title="사진">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {profile.images.map((image) => (
              <li
                key={image.id}
                className="aspect-3/4 overflow-hidden rounded-[12px] bg-[var(--color-ivory-200)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="회원에게 보이는 내용">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts
            .filter((f): f is [string, string] => f[1] != null && f[1] !== "")
            .map(([key, value]) => (
              <div key={key} className="flex gap-3 text-[13.5px]">
                <dt className="w-20 shrink-0 text-[var(--surface-text-muted)]">{key}</dt>
                <dd className="text-[var(--surface-text)]">{value}</dd>
              </div>
            ))}
        </dl>

        {profile.bio ? (
          <div className="mt-5">
            <p className="text-[12.5px] text-[var(--surface-text-muted)]">소개</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--surface-text)]">
              {profile.bio}
            </p>
          </div>
        ) : null}

        {profile.idealTypeText ? (
          <div className="mt-4">
            <p className="text-[12.5px] text-[var(--surface-text-muted)]">이상형</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--surface-text)]">
              {profile.idealTypeText}
            </p>
          </div>
        ) : null}
      </Panel>

      {profile.realName || profile.contactNote ? (
        <Panel title="연결된 분">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {profile.realName ? (
              <div className="flex gap-3 text-[13.5px]">
                <dt className="w-20 shrink-0 text-[var(--surface-text-muted)]">이름</dt>
                <dd className="text-[var(--surface-text)]">{profile.realName}</dd>
              </div>
            ) : null}
            {profile.contactNote ? (
              <div className="flex gap-3 text-[13.5px]">
                <dt className="w-20 shrink-0 text-[var(--surface-text-muted)]">연락 방법</dt>
                <dd className="text-[var(--surface-text)]">{profile.contactNote}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>
      ) : null}
    </div>
  );
}
