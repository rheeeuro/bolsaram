"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DRINKING_LABELS,
  DRINKING_LEVELS,
  GENDERS,
  GENDER_LABELS,
  HASHTAG_MAX_COUNT,
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  MBTI_TYPES,
  REGIONS,
  REGION_LABELS,
  RELIGIONS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  SMOKING_LEVELS,
  formatHashtag,
  parseHashtagInput,
} from "@bolsaram/schemas";
import { ProfileCode } from "@/components/ui/marks";
import { cn } from "@/lib/cn";
import { Button, buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { ProfilePhotos } from "@/components/host/profile-photos";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { apiPatch } from "@/lib/api-client";
import type { ProfileDetailView } from "@/server/views/profile-view";

type Draft = Record<string, string>;

/** 프로필 레코드 → 폼 초기값. 저장 기준점과 편집값 둘 다 여기서 시작한다. */
function initialDraft(profile: ProfileDetailView): Draft {
  return {
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
    hashtags: profile.hashtags.map(formatHashtag).join(" "),
    bio: profile.bio ?? "",
    idealTypeText: profile.idealTypeText ?? "",
    realName: profile.realName ?? "",
    contactNote: profile.contactNote ?? "",
  };
}

/**
 * 프로필 내용 편집.
 *
 * 이 화면은 **고치는 일만** 한다 — 공개 여부·초대·대행은 상세(`/profiles/[id]`)에
 * 남겼다. 저장을 눌러야 반영되는 것과 누르는 즉시 끝나는 것을 한 화면에 섞으면
 * 어느 쪽이 아직 저장 전인지 알 수 없다.
 *
 * 사진은 여기 둔다. 고르는 순간 올라가지만 「내용을 고치는 일」의 일부다.
 */
export function HostProfileEditor({ profile }: { profile: ProfileDetailView }) {
  const router = useRouter();
  const detailHref = `/profiles/${profile.id}`;
  // 저장 기준점. 저장에 성공하면 여기를 지금 값으로 옮긴다 — 그래야 「고친 것이 있는지」를
  // 서버가 돌려준 값이 아니라 화면에서 바로 판정할 수 있다.
  const [saved, setSaved] = useState<Draft>(() => initialDraft(profile));
  const [draft, setDraft] = useState<Draft>(() => initialDraft(profile));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 고치기 시작하면 지난 결과 문구를 지운다 — 다음 편집 중에 「저장했습니다」가
  // 남아 있으면 방금 저장된 것으로 읽힌다.
  const set = (key: string) => (value: string) => {
    setMessage(null);
    setDraft((p) => ({ ...p, [key]: value }));
  };

  async function save(then?: "back") {
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
      // 정규화는 스키마가 한 번 더 한다. 여기서 쪼개는 것은 입력 형태를 풀어 주기 위해서다.
      hashtags: parseHashtagInput(draft.hashtags ?? ""),
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
    setSaved(draft);
    setMessage("저장했습니다.");
    if (then === "back") {
      // 이탈 확인은 링크 클릭과 새로고침만 잡는다. 저장이 끝난 뒤의 이동이라
      // 여기서 확인창이 뜰 일은 없다.
      router.push(detailHref);
      return;
    }
    router.refresh();
  }

  // 고친 것이 하나라도 있는가. 저장 버튼을 잠그고 이탈 경고를 걸 기준이다.
  const dirty = Object.keys(draft).some((key) => draft[key] !== saved[key]);

  // 새로고침·탭 닫기뿐 아니라 앱 안의 링크 이동도 확인한다. Next App Router에는
  // 전역 이동 차단 API가 없어서 같은 출처 링크 클릭을 캡처 단계에서 잡는다.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const guardLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const element = event.target instanceof Element ? event.target : null;
      const link = element?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.href === window.location.href) return;
      if (window.confirm("저장하지 않은 변경이 있습니다. 이 화면을 나갈까요?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardLink, true);
    };
  }, [dirty]);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="display text-[22px] leading-none text-[var(--color-ink-900)]">
            <ProfileCode code={profile.code} /> 내용 고치기
          </h1>
          <p className="mt-2 text-[12.5px] text-[var(--surface-text-muted)]">
            공개 여부와 초대는 상세 화면에서 다룹니다.
          </p>
        </div>
        <Link href={detailHref} className={buttonClasses({ variant: "secondary" })}>
          상세로 돌아가기
        </Link>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <Panel title="멤버에게 보이는 내용">
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

            <div className="mt-4 flex flex-col gap-3.5">
              <Field label="취미" hint="쉼표로 구분">
                <Input value={draft.hobbies} onChange={(e) => set("hobbies")(e.target.value)} />
              </Field>
              <Field label="해시태그" hint={`공백이나 쉼표로 구분 · 최대 ${HASHTAG_MAX_COUNT}개`}>
                <Input
                  value={draft.hashtags}
                  placeholder="#등산 #카페투어"
                  onChange={(e) => set("hashtags")(e.target.value)}
                />
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
          </Panel>

          {/* 칸이 스무 개가 넘어 맨 아래 버튼 하나로는 고친 것을 두고 화면을 떠나기 쉽다.
              아래에 붙여 두고, 고친 것이 있을 때만 눈에 띄게 한다. */}
          <div
            className={cn(
              "sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 rounded-t-[12px] px-1 py-3",
              dirty
                ? "border-t border-[var(--color-rose-200)] bg-[var(--color-ivory-50)]/95 backdrop-blur"
                : "",
            )}
          >
            <Button size="lg" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? "저장 중…" : "저장"}
            </Button>
            {/* 고친 뒤 상세로 돌아가는 것이 기본 흐름이다 — 저장하고 나가기를 한 번에 한다. */}
            {dirty ? (
              <Button
                size="lg"
                variant="secondary"
                disabled={busy}
                onClick={() => void save("back")}
              >
                저장하고 닫기
              </Button>
            ) : null}
            {dirty && !busy ? (
              <span className="text-[13px] text-[var(--color-burgundy-700)]">
                저장하지 않은 변경이 있습니다.
              </span>
            ) : null}
            {/* 저장 결과는 화면을 보지 않는 사용자에게도 전달돼야 한다. */}
            <span role="status" className="text-[13px] text-[var(--color-success)]">
              {message}
            </span>
            <FormError>{error}</FormError>
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
        </aside>
      </div>
    </div>
  );
}
