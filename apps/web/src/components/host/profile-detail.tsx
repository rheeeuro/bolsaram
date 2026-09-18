"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PROFILE_STATUSES,
  PROFILE_STATUS_LABELS,
  VISIBILITIES,
  VISIBILITY_LABELS,
} from "@bolsaram/schemas";
import { isDiscoverable } from "@bolsaram/domain";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field, FormError, Select } from "@/components/ui/field";
import { HashtagChip, ProfileCode } from "@/components/ui/marks";
import { Panel } from "@/components/host/surface";
import { apiPatch, apiPost } from "@/lib/api-client";
import { label } from "@/lib/labels";
import type { ProfileDetailView } from "@/server/views/profile-view";

/** 어느 칸에서 난 실패인가. 패널이 셋이라 한 곳에 모아 두면 짝을 잃는다. */
type Scope = "status" | "acting" | "invite";

function messageFor(
  error: { scope: Scope; message: string } | null,
  scope: Scope,
): string | null {
  return error?.scope === scope ? error.message : null;
}

/**
 * 프로필 상세.
 *
 * 카드를 누르면 **누가 등록했든 같은 화면**이 열린다 — 내가 등록한 분만 편집 폼이
 * 열리면 「이 사람이 멤버에게 어떻게 보이나」를 볼 방법이 사라진다. 고치는 일은
 * `/profiles/[id]/edit` 으로 따로 나갔다.
 *
 * 여기 남은 것은 읽기와 **운영 액션**(공개 여부·초대·대행)이다. 둘 다 폼 저장과
 * 무관하게 그 자리에서 끝나므로 저장하지 않은 변경을 만들지 않는다.
 *
 * 이름과 연락처는 공개 단계가 허락할 때만 `profile` 에 들어온다 — 여기서 다시
 * 판정하지 않는다.
 */
export function HostProfileDetail({
  profile,
  canEdit,
  status,
  visibility,
  claimed,
  invite,
}: {
  profile: ProfileDetailView;
  canEdit: boolean;
  status: string;
  visibility: string;
  claimed: boolean;
  invite: { expiresAt: string; claimed: boolean } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // 실패는 누른 칸 옆에서 말해야 한다 — 패널이 셋이라 한 곳에 모으면 무엇이
  // 실패했는지 알 수 없다.
  const [error, setError] = useState<{ scope: Scope; message: string } | null>(null);
  // 발급 직후 한 번만 보여줄 값. 링크와 입장코드는 같은 토큰이다.
  const [issued, setIssued] = useState<{ url: string; code: string } | null>(null);

  async function changeStatus(next: string, nextVisibility?: string) {
    setBusy(true);
    setError(null);
    const result = await apiPatch(`/api/profiles/${profile.id}/status`, {
      status: next,
      ...(nextVisibility ? { visibility: nextVisibility } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError({ scope: "status", message: result.message });
      return;
    }
    router.refresh();
  }

  // 상태와 노출은 직교한다 — 「공개」인데 노출이 「비공개」면 아무도 못 본다.
  // 두 값을 나란히 두기만 하면 그 조합을 사람이 머릿속에서 계산해야 한다.
  const visible = isDiscoverable({
    status: status as Parameters<typeof isDiscoverable>[0]["status"],
    visibility: visibility as Parameters<typeof isDiscoverable>[0]["visibility"],
  });

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
  const shown = facts.filter((f): f is [string, string] => f[1] != null && f[1] !== "");

  return (
    <div className="flex flex-col gap-5">
      {!canEdit ? (
        <p className="rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3 text-[13px] leading-relaxed text-[var(--surface-text-muted)]">
          다른 주선자가 등록한 분입니다. 내용을 고치거나 초대를 보낼 수는 없습니다.
        </p>
      ) : null}

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
            <ProfileCode code={profile.code} />
          </h1>
          <p className="mt-2.5 text-[13.5px] text-[var(--surface-text-muted)]">{summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={toneForStatus(status)}>{label.profileStatus(status)}</Badge>
            <Badge tone={visible ? "active" : "neutral"}>
              {visible ? "멤버에게 보임" : "멤버에게 안 보임"}
            </Badge>
            <span className="text-[12.5px] text-[var(--surface-text-muted)]">
              {label.visibility(visibility)}
            </span>
            {canEdit ? (
              <span className="text-[12.5px] text-[var(--surface-text-muted)]">
                · {claimed ? "본인 계정 연결됨" : "아직 초대하지 않았습니다"}
              </span>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          <div className="flex w-full flex-wrap gap-2.5 sm:w-auto">
            {/* 아직 공개 전이면 가장 자주 누르는 버튼이 「공개」다. 편집보다 앞에 둔다. */}
            {status !== "ACTIVE" ? (
              <Button
                size="lg"
                disabled={busy}
                className="flex-1 sm:flex-none"
                onClick={() => void changeStatus("ACTIVE", "LISTED")}
              >
                지금 공개하기
              </Button>
            ) : null}
            <Link
              href={`/profiles/${profile.id}/edit`}
              className={buttonClasses({
                variant: status !== "ACTIVE" ? "secondary" : "primary",
                size: "lg",
                className: "flex-1 sm:flex-none",
              })}
            >
              내용 고치기
            </Link>
          </div>
        ) : null}
      </section>

      <div className={canEdit ? "grid gap-5 lg:grid-cols-[1fr_320px]" : "grid gap-5"}>
        <div className="flex flex-col gap-5">
          {profile.images.length > 1 ? (
            <Panel title={`사진 ${profile.images.length}장`}>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {profile.images.map((image) => (
                  <li
                    key={image.id}
                    className="relative aspect-3/4 overflow-hidden rounded-[12px] bg-[var(--color-ivory-200)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {image.isPrimary ? (
                      <span className="absolute left-1 top-1 rounded bg-[var(--color-burgundy-900)]/75 px-1.5 py-0.5 text-[10px] text-white">
                        대표
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="멤버에게 보이는 내용">
            {shown.length > 0 ? (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {shown.map(([key, value]) => (
                  <div key={key} className="flex gap-3 text-[13.5px]">
                    <dt className="w-20 shrink-0 text-[var(--surface-text-muted)]">{key}</dt>
                    <dd className="text-[var(--surface-text)]">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-[var(--surface-text-muted)]">
                아직 적힌 내용이 없습니다.
              </p>
            )}

            {profile.hashtags.length > 0 ? (
              <div className="mt-5">
                <p className="text-[12.5px] text-[var(--surface-text-muted)]">해시태그</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {profile.hashtags.map((tag) => (
                    <HashtagChip key={tag} tag={tag} />
                  ))}
                </div>
              </div>
            ) : null}

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

          {/* 담당이면 비어 있어도 보여준다 — 초대를 보내기 전에 채워야 하는 칸이다. */}
          {canEdit || profile.realName || profile.contactNote ? (
            <Panel title="연결된 뒤에만 보이는 내용">
              {canEdit ? (
                <p className="mb-3.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
                  서로 마음이 닿아 연결되기 전까지는 상대에게 보이지 않습니다.
                </p>
              ) : null}
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {(
                  [
                    ["이름", profile.realName ?? null],
                    ["연락 방법", profile.contactNote ?? null],
                  ] as [string, string | null][]
                )
                  .filter(([, value]) => canEdit || (value != null && value !== ""))
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-3 text-[13.5px]">
                      <dt className="w-20 shrink-0 text-[var(--surface-text-muted)]">{key}</dt>
                      <dd
                        className={
                          value ? "text-[var(--surface-text)]" : "text-[var(--color-ink-500)]"
                        }
                      >
                        {value || "아직 적지 않았습니다"}
                      </dd>
                    </div>
                  ))}
              </dl>
            </Panel>
          ) : null}
        </div>

        {canEdit ? (
          <aside className="flex flex-col gap-5">
            <Panel title="공개 설정">
              <p
                className={
                  visible
                    ? "mb-3.5 rounded-[10px] bg-[var(--color-success)]/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-success)]"
                    : "mb-3.5 rounded-[10px] bg-[var(--color-ivory-100)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]"
                }
              >
                {visible
                  ? "지금 멤버 목록에 보입니다."
                  : `지금 멤버 목록에 보이지 않습니다 — ${reasonHidden(status, visibility)}.`}
              </p>
              <div className="flex flex-col gap-3.5">
                <Field label="상태">
                  <Select
                    value={status}
                    onChange={(e) => void changeStatus(e.target.value)}
                    disabled={busy}
                  >
                    {PROFILE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PROFILE_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="노출">
                  <Select
                    value={visibility}
                    onChange={(e) => void changeStatus(status, e.target.value)}
                    disabled={busy}
                  >
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {VISIBILITY_LABELS[v]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {/* 바꾸자마자 서버로 간다 — 실패를 말해주지 않으면 값이 되돌아간 이유를 알 수 없다. */}
              <FormError>{messageFor(error, "status")}</FormError>
            </Panel>

            <Panel title="대신 둘러보기">
              <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
                휴대폰 쓰기를 꺼리는 분은 주선자가 자기 폰으로 대신 봅니다. 초대는 소진되지
                않고 주선자 로그인도 그대로 유지됩니다.
              </p>
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    const result = await apiPost("/api/admin/acting", {
                      profileId: profile.id,
                    });
                    setBusy(false);
                    if (!result.ok) {
                      setError({ scope: "acting", message: result.message });
                      return;
                    }
                    router.push("/discover");
                  })();
                }}
              >
                이 분으로 둘러보기
              </Button>
              <FormError>{messageFor(error, "acting")}</FormError>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                대행 중에는 화면 아래에 띠가 뜨고, 거기서 언제든 주선자로 돌아옵니다. 끝내지
                않으면 로그아웃할 때까지 이어집니다.
              </p>
              {claimed ? (
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                  본인 계정이 연결된 분입니다. 본인도 같은 화면을 직접 볼 수 있으니, 대신
                  누르기 전에 확인해 주세요.
                </p>
              ) : null}
            </Panel>

            <Panel title="본인에게 보내기">
              {claimed ? (
                <p className="text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
                  이미 본인 계정에 연결되어 있습니다. 본인이 직접 들어와 시그널을 확인합니다.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
                    멤버는 아이디·비밀번호가 없습니다. 이 링크가 곧 로그인입니다.
                  </p>
                  {invite && !invite.claimed ? (
                    <p className="mb-3 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
                      발급된 초대가 있습니다 (만료{" "}
                      {new Date(invite.expiresAt).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                      })}
                      ). 새로 발급하면 기존 링크와 입장코드는 무효가 됩니다.
                    </p>
                  ) : null}

                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        setError(null);
                        const result = await apiPost<{ url: string; code: string }>(
                          "/api/admin/invites",
                          { profileId: profile.id, expiresInHours: 72 },
                        );
                        setBusy(false);
                        if (!result.ok) {
                          setError({ scope: "invite", message: result.message });
                          return;
                        }
                        setIssued({ url: result.data.url, code: result.data.code });
                        router.refresh();
                      })();
                    }}
                  >
                    초대 링크 발급
                  </Button>
                  <FormError>{messageFor(error, "invite")}</FormError>

                  {issued ? (
                    <div className="mt-3.5 flex flex-col gap-2.5 rounded-[12px] bg-[var(--color-ivory-100)] p-3">
                      <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                        지금만 볼 수 있습니다. 복사해서 카카오톡으로 보내세요.
                      </p>
                      <CopyField label="초대 링크" value={issued.url} />
                      <CopyField label="입장코드" value={issued.code} />
                      <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                        둘은 같은 것입니다. 링크를 못 여는 경우에만 코드를 보내고, 멤버는 입장
                        화면에서 코드를 넣습니다.
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </Panel>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 왜 안 보이는지 한 마디로 말한다.
 *
 * 「상태를 공개로 바꿨는데 왜 안 보이지」가 가장 흔한 막힘이다 — 노출이 따로 남아
 * 있기 때문인데 화면이 말해주지 않으면 알 길이 없다.
 */
function reasonHidden(status: string, visibility: string): string {
  if (status !== "ACTIVE" && status !== "MATCHING") {
    return `상태가 「${label.profileStatus(status) ?? status}」입니다`;
  }
  return `노출이 「${label.visibility(visibility) ?? visibility}」입니다`;
}
