"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DRINKING_LABELS,
  DRINKING_LEVELS,
  GENDERS,
  GENDER_LABELS,
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  MBTI_TYPES,
  PROFILE_STATUSES,
  PROFILE_STATUS_LABELS,
  REGIONS,
  REGION_LABELS,
  RELIGIONS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  SMOKING_LEVELS,
  VISIBILITIES,
  VISIBILITY_LABELS,
} from "@bolsaram/schemas";
import { isDiscoverable } from "@bolsaram/domain";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { ProfilePhotos } from "@/components/host/profile-photos";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { apiPatch, apiPost } from "@/lib/api-client";
import { label } from "@/lib/labels";
import type { ProfileDetailView } from "@/server/views/profile-view";

type Draft = Record<string, string>;

/**
 * 프로필 상세 편집.
 *
 * 회원이 보게 될 사람을 먼저 크게 보여주고(사진·공개 번호·요약), 그 아래에서 고친다.
 * 공개 여부와 초대는 오른쪽에 모아 둔다 — 주선자가 가장 자주 누르는 두 가지다.
 */
export function HostProfileEditor({
  profile,
  claimed,
  invite,
}: {
  profile: ProfileDetailView;
  claimed: boolean;
  invite: { expiresAt: string; claimed: boolean } | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({
    gender: profile.gender,
    birthYear: String(profile.birthYear),
    height: profile.height == null ? "" : String(profile.height),
    jobTitle: profile.jobTitle ?? "",
    jobCategory: profile.jobCategory ?? "",
    company: profile.company ?? "",
    education: profile.education ?? "",
    residenceRegion: profile.residenceRegion,
    workplaceRegion: profile.workplaceRegion ?? "",
    religion: profile.religion ?? "",
    mbti: profile.mbti ?? "",
    smoking: profile.smoking ?? "",
    drinking: profile.drinking ?? "",
    hobbies: profile.hobbies.join(", "),
    bio: profile.bio ?? "",
    idealTypeText: profile.idealTypeText ?? "",
    realName: profile.realName ?? "",
    contactNote: profile.contactNote ?? "",
  }));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 발급 직후 한 번만 보여줄 값. 링크와 입장코드는 같은 토큰이다.
  const [issued, setIssued] = useState<{ url: string; code: string } | null>(null);

  const set = (key: string) => (value: string) => setDraft((p) => ({ ...p, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await apiPatch(`/api/profiles/${profile.id}`, {
      gender: draft.gender,
      birthYear: Number(draft.birthYear),
      height: draft.height ? Number(draft.height) : null,
      jobTitle: draft.jobTitle,
      jobCategory: draft.jobCategory || null,
      company: draft.company,
      education: draft.education,
      residenceRegion: draft.residenceRegion,
      workplaceRegion: draft.workplaceRegion || null,
      religion: draft.religion || null,
      mbti: draft.mbti || null,
      smoking: draft.smoking || null,
      drinking: draft.drinking || null,
      hobbies: (draft.hobbies ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      bio: draft.bio,
      idealTypeText: draft.idealTypeText,
      realName: draft.realName,
      contactNote: draft.contactNote,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage("저장했습니다.");
    router.refresh();
  }

  async function changeStatus(status: string, visibility?: string) {
    setBusy(true);
    setError(null);
    const result = await apiPatch(`/api/profiles/${profile.id}/status`, {
      status,
      ...(visibility ? { visibility } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  // 상태와 노출은 직교한다 — 「공개」인데 노출이 「비공개」면 아무도 못 본다.
  // 두 드롭다운을 나란히 두기만 하면 그 조합을 사람이 머릿속에서 계산해야 한다.
  const visible = isDiscoverable({
    status: (profile.status ?? "INACTIVE") as Parameters<typeof isDiscoverable>[0]["status"],
    visibility: (profile.visibility ??
      "PRIVATE") as Parameters<typeof isDiscoverable>[0]["visibility"],
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

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center gap-5 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)]">
        <div className="h-32 w-24 shrink-0 overflow-hidden rounded-[12px] bg-[var(--color-ivory-200)]">
          {profile.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.images[0].url}
              alt=""
              className="h-full w-full object-cover"
            />
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={toneForStatus(profile.status ?? "")}>
              {label.profileStatus(profile.status)}
            </Badge>
            <Badge tone={visible ? "active" : "neutral"}>
              {visible ? "회원에게 보임" : "회원에게 안 보임"}
            </Badge>
            <span className="text-[12.5px] text-[var(--surface-text-muted)]">
              {label.visibility(profile.visibility)}
            </span>
            <span className="text-[12.5px] text-[var(--surface-text-muted)]">
              {claimed ? "· 본인 계정 연결됨" : "· 아직 초대하지 않았습니다"}
            </span>
          </div>
        </div>

        {profile.status !== "ACTIVE" ? (
          <Button size="lg" disabled={busy} onClick={() => void changeStatus("ACTIVE", "LISTED")}>
            지금 공개하기
          </Button>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <Panel title="회원에게 보이는 내용">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="성별">
                <Select value={draft.gender} onChange={(e) => set("gender")(e.target.value)}>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {GENDER_LABELS[g]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="출생연도">
                <Input
                  inputMode="numeric"
                  value={draft.birthYear}
                  onChange={(e) => set("birthYear")(e.target.value)}
                />
              </Field>
              <Field label="키 (cm)">
                <Input
                  inputMode="numeric"
                  value={draft.height}
                  onChange={(e) => set("height")(e.target.value)}
                />
              </Field>
              <Field label="MBTI">
                <Select value={draft.mbti} onChange={(e) => set("mbti")(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {MBTI_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="직업">
                <Input
                  value={draft.jobTitle}
                  onChange={(e) => set("jobTitle")(e.target.value)}
                />
              </Field>
              <Field label="직업군">
                <Select
                  value={draft.jobCategory}
                  onChange={(e) => set("jobCategory")(e.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {JOB_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {JOB_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="회사">
                <Input value={draft.company} onChange={(e) => set("company")(e.target.value)} />
              </Field>
              <Field label="학력">
                <Input
                  value={draft.education}
                  onChange={(e) => set("education")(e.target.value)}
                />
              </Field>
              <Field label="거주 지역">
                <Select
                  value={draft.residenceRegion}
                  onChange={(e) => set("residenceRegion")(e.target.value)}
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {REGION_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="직장 지역">
                <Select
                  value={draft.workplaceRegion}
                  onChange={(e) => set("workplaceRegion")(e.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {REGION_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="종교">
                <Select
                  value={draft.religion}
                  onChange={(e) => set("religion")(e.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {RELIGIONS.map((r) => (
                    <option key={r} value={r}>
                      {RELIGION_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="흡연">
                <Select value={draft.smoking} onChange={(e) => set("smoking")(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {SMOKING_LEVELS.map((s) => (
                    <option key={s} value={s}>
                      {SMOKING_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="음주">
                <Select
                  value={draft.drinking}
                  onChange={(e) => set("drinking")(e.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {DRINKING_LEVELS.map((d) => (
                    <option key={d} value={d}>
                      {DRINKING_LABELS[d]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-4 flex flex-col gap-3.5">
              <Field label="취미" hint="쉼표로 구분">
                <Input value={draft.hobbies} onChange={(e) => set("hobbies")(e.target.value)} />
              </Field>
              <Field label="자기소개">
                <Textarea value={draft.bio} onChange={(e) => set("bio")(e.target.value)} />
              </Field>
              <Field label="이상형">
                <Textarea
                  value={draft.idealTypeText}
                  onChange={(e) => set("idealTypeText")(e.target.value)}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="연결된 뒤에만 보이는 내용">
            <p className="mb-3.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
              서로 마음이 닿아 연결되기 전까지는 상대에게 보이지 않습니다.
            </p>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="이름">
                <Input
                  value={draft.realName}
                  onChange={(e) => set("realName")(e.target.value)}
                />
              </Field>
              <Field label="연락 방법">
                <Input
                  value={draft.contactNote}
                  onChange={(e) => set("contactNote")(e.target.value)}
                  placeholder="카카오톡 ID 등"
                />
              </Field>
            </div>
          </Panel>

          <div className="flex items-center gap-3">
            <Button size="lg" disabled={busy} onClick={() => void save()}>
              {busy ? "저장 중…" : "저장"}
            </Button>
            {message ? (
              <span className="text-[13px] text-[var(--color-success)]">{message}</span>
            ) : null}
            {error ? (
              <span className="text-[13px] text-[var(--color-danger)]">{error}</span>
            ) : null}
          </div>
        </div>

        <aside className="flex flex-col gap-5">
          <Panel title="사진">
            <ProfilePhotos
              profileId={profile.id}
              images={profile.images.map((image) => ({
                id: image.id,
                url: image.url,
                isPrimary: image.isPrimary,
              }))}
            />
          </Panel>

          <Panel title="공개 설정">
            <p
              className={
                visible
                  ? "mb-3.5 rounded-[10px] bg-[var(--color-success)]/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-success)]"
                  : "mb-3.5 rounded-[10px] bg-[var(--color-ivory-100)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]"
              }
            >
              {visible
                ? "지금 회원 목록에 보입니다."
                : `지금 회원 목록에 보이지 않습니다 — ${reasonHidden(profile.status, profile.visibility)}.`}
            </p>
            <div className="flex flex-col gap-3.5">
              <Field label="상태">
                <Select
                  value={profile.status ?? ""}
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
                  value={profile.visibility ?? ""}
                  onChange={(e) =>
                    void changeStatus(profile.status ?? "INACTIVE", e.target.value)
                  }
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
          </Panel>

          <Panel title="대신 둘러보기">
            <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
              휴대폰 쓰기를 꺼리는 분은 주선자가 자기 폰으로 대신 봅니다. 초대는
              소진되지 않고 주선자 로그인도 그대로 유지됩니다.
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
                    setError(result.message);
                    return;
                  }
                  router.push("/discover");
                })();
              }}
            >
              이 분으로 둘러보기
            </Button>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
              대행 중에는 화면 아래에 띠가 뜨고, 거기서 언제든 주선자로 돌아옵니다.
              끝내지 않으면 로그아웃할 때까지 이어집니다.
            </p>
            {claimed ? (
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                본인 계정이 연결된 분입니다. 본인도 같은 화면을 직접 볼 수 있으니,
                대신 누르기 전에 확인해 주세요.
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
                  회원은 아이디·비밀번호가 없습니다. 이 링크가 곧 로그인입니다.
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
                        setError(result.message);
                        return;
                      }
                      setIssued({ url: result.data.url, code: result.data.code });
                      router.refresh();
                    })();
                  }}
                >
                  초대 링크 발급
                </Button>

                {issued ? (
                  <div className="mt-3.5 flex flex-col gap-2.5 rounded-[12px] bg-[var(--color-ivory-100)] p-3">
                    <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                      지금만 볼 수 있습니다. 복사해서 카카오톡으로 보내세요.
                    </p>
                    <CopyField label="초대 링크" value={issued.url} />
                    <CopyField label="입장코드" value={issued.code} />
                    <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
                      둘은 같은 것입니다. 링크를 못 여는 경우에만 코드를 보내고, 회원은 입장
                      화면에서 코드를 넣습니다.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </Panel>
        </aside>
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
function reasonHidden(
  status: string | null | undefined,
  visibility: string | null | undefined,
): string {
  if (status !== "ACTIVE" && status !== "MATCHING") {
    return `상태가 「${label.profileStatus(status) ?? status}」입니다`;
  }
  return `노출이 「${label.visibility(visibility) ?? visibility}」입니다`;
}

