/**
 * 등록 동의 (마이그레이션 0019).
 *
 * 프로필은 주선자가 남을 대신해 등록한다. 여기서 지키는 성질:
 *   * 기록 없이 게시할 수 없다 — **DB 가** 막는다.
 *   * 「확인했다는데 언제인지 모르는」 기록을 만들 수 없다.
 *   * 합성 데이터(SYNTHETIC)와 확인 필요(LEGACY)는 실제 동의가 아니다.
 *   * 비공개로 내리는 것은 기록과 무관하게 언제나 된다(문제를 발견하면 즉시 내려야 한다).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, type Sql } from "@bolsaram/db";
import {
  DomainError,
  assertConsentForVisibility,
  hasConfirmedConsent,
  needsConsentReview,
} from "@bolsaram/domain";

const TAG = `consenttest-${Date.now()}`;

let groupId: string;
let adminId: string;

async function insertProfile(
  sql: Sql,
  values: { visibility: string; consentMethod?: string; consentAt?: string | null },
): Promise<string> {
  const r = await sql.query<{ id: string }>(
    `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                           status, visibility, real_name, created_by,
                           consent_method, consent_at)
     VALUES ($1,'FEMALE',1993,'SEOUL','ACTIVE',$2,$3,$4,$5,$6) RETURNING id`,
    [
      groupId,
      values.visibility,
      `${TAG}-${Math.random()}`,
      adminId,
      values.consentMethod ?? null,
      values.consentAt ?? null,
    ],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [`${TAG}-group`],
    );
    groupId = g.rows[0]!.id;
    const a = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
      [`${TAG}@test.local`, `${TAG}-admin`],
    );
    adminId = a.rows[0]!.id;
  });
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("DB 가 게시를 막는다", () => {
  it("기록 없이 LISTED 로 만들 수 없다", async () => {
    await expect(
      withOwner((sql) => insertProfile(sql, { visibility: "LISTED" })),
    ).rejects.toThrow(/profiles_listed_requires_consent/);
  });

  it("기록 없이 비공개로는 만들 수 있다", async () => {
    const id = await withOwner((sql) => insertProfile(sql, { visibility: "PRIVATE" }));
    expect(id).toBeTruthy();
  });

  it("기록 없는 프로필을 나중에 LISTED 로 바꿀 수도 없다", async () => {
    const id = await withOwner((sql) => insertProfile(sql, { visibility: "PRIVATE" }));
    await expect(
      withOwner((sql) =>
        sql.query(`UPDATE profiles SET visibility = 'LISTED' WHERE id = $1`, [id]),
      ),
    ).rejects.toThrow(/profiles_listed_requires_consent/);
  });

  it("확인 방법만 있고 확인 시각이 없으면 거부한다", async () => {
    await expect(
      withOwner((sql) =>
        insertProfile(sql, { visibility: "PRIVATE", consentMethod: "KAKAO" }),
      ),
    ).rejects.toThrow(/profiles_consent_pair/);
  });

  it("합성·확인필요 표식에는 확인 시각이 붙지 않는다", async () => {
    await expect(
      withOwner((sql) =>
        insertProfile(sql, {
          visibility: "PRIVATE",
          consentMethod: "LEGACY",
          consentAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow(/profiles_consent_pair/);
  });

  it("확인한 동의가 있으면 게시된다", async () => {
    const id = await withOwner((sql) =>
      insertProfile(sql, {
        visibility: "LISTED",
        consentMethod: "KAKAO",
        consentAt: new Date().toISOString(),
      }),
    );
    expect(id).toBeTruthy();
  });
});

describe("도메인 판정", () => {
  const confirmed = { method: "KAKAO" as const, confirmedAt: new Date() };
  const synthetic = { method: "SYNTHETIC" as const, confirmedAt: null };
  const legacy = { method: "LEGACY" as const, confirmedAt: null };
  const none = { method: null, confirmedAt: null };

  it("실제로 확인한 것만 동의로 센다", () => {
    expect(hasConfirmedConsent(confirmed)).toBe(true);
    expect(hasConfirmedConsent(synthetic)).toBe(false);
    expect(hasConfirmedConsent(legacy)).toBe(false);
    expect(hasConfirmedConsent(none)).toBe(false);
  });

  it("확인이 필요한 것을 가려낸다", () => {
    expect(needsConsentReview(legacy)).toBe(true);
    expect(needsConsentReview(none)).toBe(true);
    expect(needsConsentReview(confirmed)).toBe(false);
    // 합성 데이터는 사람이 아니므로 확인 대상이 아니다 — 지울 대상이다.
    expect(needsConsentReview(synthetic)).toBe(false);
  });

  it("확인 없이는 회원에게 보이게 만들 수 없다", () => {
    expect(() => assertConsentForVisibility("LISTED", legacy)).toThrow(DomainError);
    expect(() => assertConsentForVisibility("UNLISTED", legacy)).toThrow(DomainError);
    expect(() => assertConsentForVisibility("LISTED", none)).toThrow(DomainError);
  });

  it("합성 데이터는 이유를 분명히 말한다", () => {
    expect(() => assertConsentForVisibility("LISTED", synthetic)).toThrow(/합성 데이터/);
  });

  it("비공개로 내리는 것은 언제나 된다", () => {
    expect(() => assertConsentForVisibility("PRIVATE", none)).not.toThrow();
    expect(() => assertConsentForVisibility("PRIVATE", synthetic)).not.toThrow();
  });

  it("확인한 동의가 있으면 통과한다", () => {
    expect(() => assertConsentForVisibility("LISTED", confirmed)).not.toThrow();
  });
});
