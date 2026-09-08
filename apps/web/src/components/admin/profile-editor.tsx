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
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/table";
import { ConsentPanel } from "@/components/admin/consent-panel";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { apiPatch, apiPost } from "@/lib/api-client";
import { label } from "@/lib/labels";
import type { ProfileDetailView } from "@/server/views/profile-view";

type Draft = Record<string, string>;

export function AdminProfileEditor({
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
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Card title="기본 정보">
          <div className="grid gap-3 sm:grid-cols-2">
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
              <Input value={draft.jobTitle} onChange={(e) => set("jobTitle")(e.target.value)} />
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
              <Select value={draft.religion} onChange={(e) => set("religion")(e.target.value)}>
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
              <Select value={draft.drinking} onChange={(e) => set("drinking")(e.target.value)}>
                <option value="">선택 안 함</option>
                {DRINKING_LEVELS.map((d) => (
                  <option key={d} value={d}>
                    {DRINKING_LABELS[d]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-3 flex flex-col gap-3">
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
        </Card>

        <Card title="비공개 정보">
          <p className="mb-3 text-[12px] text-[var(--surface-text-muted)]">
            연결(INTRODUCED)된 상대에게만 공개됩니다.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="이름">
              <Input value={draft.realName} onChange={(e) => set("realName")(e.target.value)} />
            </Field>
            <Field label="연락 방법">
              <Input
                value={draft.contactNote}
                onChange={(e) => set("contactNote")(e.target.value)}
                placeholder="카카오톡 ID 등"
              />
            </Field>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button disabled={busy} onClick={() => void save()}>
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

      <aside className="flex flex-col gap-4">
        <Card title="사진">
          {profile.images.length === 0 ? (
            <p className="text-[12.5px] text-[var(--surface-text-muted)]">
              등록된 사진이 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {profile.images.map((image) => (
                <div
                  key={image.id}
                  className="relative aspect-3/4 overflow-hidden rounded bg-[var(--surface-muted)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                  {image.isPrimary ? (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      대표
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="게시 상태">
          <div className="mb-3 flex items-center gap-2">
            <Badge tone={toneForStatus(profile.status ?? "")}>
              {label.profileStatus(profile.status)}
            </Badge>
            <span className="text-[12px] text-[var(--surface-text-muted)]">
              {label.visibility(profile.visibility)}
            </span>
          </div>

          {profile.status !== "ACTIVE" ? (
            <Button
              size="sm"
              className="mb-3 w-full"
              disabled={busy}
              onClick={() => void changeStatus("ACTIVE", "LISTED")}
            >
              지금 공개하기
            </Button>
          ) : null}

          <div className="flex flex-col gap-2">
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
        </Card>

        <ConsentPanel profileId={profile.id} consent={profile.consent} />

        <Card title="계정 연결">
          {claimed ? (
            <p className="text-[12.5px] text-[var(--surface-text-muted)]">
              이미 회원 계정에 연결되어 있습니다.
            </p>
          ) : (
            <>
              {invite && !invite.claimed ? (
                <p className="mb-2.5 text-[12px] text-[var(--surface-text-muted)]">
                  발급된 초대가 있습니다 (만료{" "}
                  {new Date(invite.expiresAt).toLocaleString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                  })}
                  ). 새로 발급하면 기존 링크는 무효가 됩니다.
                </p>
              ) : null}

              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    const result = await apiPost<{ url: string }>("/api/admin/invites", {
                      profileId: profile.id,
                      expiresInHours: 72,
                    });
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.message);
                      return;
                    }
                    setInviteUrl(result.data.url);
                    router.refresh();
                  })();
                }}
              >
                초대 링크 발급
              </Button>

              {inviteUrl ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11.5px] text-[var(--surface-text-muted)]">
                    이 링크는 지금만 볼 수 있습니다. 복사해서 전달하세요.
                  </p>
                  <div className="flex gap-1.5">
                    <Input readOnly value={inviteUrl} className="h-8 flex-1 text-[11.5px]" />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                    >
                      복사
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </aside>
    </div>
  );
}
