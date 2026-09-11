/** 내 프로필 + 로그아웃. 회원은 열람만 하고 수정은 주선자에게 요청한다. */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { findProfileById } from "@/server/repo/profiles";
import { toDetailView } from "@/server/views/profile-view";
import { label } from "@/lib/labels";
import { LogoutButton } from "@/components/member/logout-button";
import { MemberHeader } from "@/components/member/member-header";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const viewer = await requireUserPage("/me");

  const profile = viewer.profileId
    ? await withRls(rlsContextOf(viewer), async (sql) => {
        const record = await findProfileById(sql, viewer.profileId!);
        return record ? toDetailView(record, "OWNER") : null;
      })
    : null;

  return (
    <>
      <MemberHeader
        title="내 프로필"
        action={
          viewer.role === "ADMIN" ? (
            <Link href="/home" className="text-[13px] text-[var(--color-rose-600)] underline">
              주선자 화면
            </Link>
          ) : null
        }
      />

      <main className="mx-auto max-w-2xl px-5 pb-8">
        {!profile ? (
          <Empty
            title="연결된 프로필이 없습니다"
            description="주선자에게 받은 초대 링크나 입장코드로 본인 프로필을 연결해 주세요."
          />
        ) : (
          <>
            <div className="flex items-center gap-4 pt-6">
              <div className="h-20 w-16 overflow-hidden rounded-xl bg-[var(--color-ivory-200)]">
                {profile.primaryImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.primaryImage.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div>
                <p className="display text-[24px] text-[var(--color-ink-900)]">
                  {profile.code}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge tone={toneForStatus(profile.status ?? "")}>
                    {label.profileStatus(profile.status)}
                  </Badge>
                  <span className="text-[12px] text-[var(--color-ink-600)]">
                    {label.visibility(profile.visibility)}
                  </span>
                </div>
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-[92px_1fr] gap-x-4 gap-y-3">
              {(
                [
                  ["출생연도", `${profile.birthYear}년`],
                  ["성별", label.gender(profile.gender)],
                  ["키", profile.height ? `${profile.height}cm` : null],
                  ["직업", profile.jobTitle],
                  ["직업군", label.jobCategory(profile.jobCategory)],
                  ["회사", profile.company],
                  ["학력", profile.education],
                  ["거주 지역", label.region(profile.residenceRegion)],
                  ["종교", label.religion(profile.religion)],
                  ["MBTI", profile.mbti],
                  ["흡연", label.smoking(profile.smoking)],
                  ["음주", label.drinking(profile.drinking)],
                  ["취미", profile.hobbies.join(", ") || null],
                ] as [string, string | null | undefined][]
              )
                .filter(([, value]) => value != null && value !== "")
                .map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-[13px] text-[var(--color-ink-500)]">{key}</dt>
                    <dd className="text-[13.5px] text-[var(--color-ink-800)]">{value}</dd>
                  </div>
                ))}
            </dl>

            {profile.bio ? (
              <section className="mt-8">
                <h2 className="kicker mb-2">자기소개</h2>
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--color-ink-800)]">
                  {profile.bio}
                </p>
              </section>
            ) : null}

            <p className="mt-8 rounded-xl bg-[var(--color-ivory-100)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
              프로필 수정이 필요하면 주선자에게 알려주세요. 사진과 소개는 주선자가 관리합니다.
            </p>

            {/* 숨김 해제로 가는 유일한 입구. 탭에 두지 않고 여기에 모은다. */}
            <Link
              href="/hidden"
              className="mt-4 flex items-center justify-between rounded-xl border border-[var(--surface-border)] px-4 py-3.5"
            >
              <span className="text-[13.5px] text-[var(--color-ink-800)]">숨긴 사람</span>
              <span className="text-[13px] text-[var(--color-ink-500)]">관리 →</span>
            </Link>
          </>
        )}

        <div className="mt-10 border-t border-[var(--surface-border)] pt-6">
          <LogoutButton needsInviteAgain={viewer.role !== "ADMIN"} />
          <p className="mt-6 text-[12px] text-[var(--color-ink-500)]">
            <Link href="/privacy" className="underline">
              개인정보 처리방침
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
