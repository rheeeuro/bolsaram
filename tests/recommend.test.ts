/**
 * 이상형 추천 (0069).
 *
 * 지키는 성질:
 * - 견주기는 규칙이다 — 맞음·다름·모름을 조건마다 판정하고, 「꼭」 조건이 다르면 뺀다.
 * - 이 분에게 이상형 글이 없어도 상대의 이상형에 이 분이 맞으면 추천한다(역방향).
 * - 조건은 검증·정리를 거친다 — 뒤집힌 범위·범위 밖 숫자·적히지 않은 「꼭」은 바로잡는다.
 * - 조건은 **가져오기 때 추출이 함께 뽑아** 프로필 항목으로 저장한다. 추천은 AI 를 부르지 않는다.
 * - 수정에서 조건을 보내지 않으면 저장된 조건은 그대로다.
 * - 멤버 탐색의 「AI 추천」은 **같은 쪽의 활성 이성** 가운데서 고르고, 숨김·거절 사이는 뺀다.
 * - 「AI 추천만」은 목록·총 인원이 같은 집합을 본다. 상세의 표시도 같은 판정이다.
 * - 조건은 멤버에게 보이는 상세에 실리지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import {
  evaluateIdeal,
  rankRecommendations,
  type RecommendSubject,
} from "@bolsaram/domain";
import {
  emptyIdealCriteria,
  idealCriteriaSchema,
  isIdealCriteriaEmpty,
  normalizeIdealCriteria,
  discoverQuerySchema,
  profileUpdateSchema,
  toStrictJsonSchema,
  type IdealCriteria,
} from "@bolsaram/schemas";
import { MockExtractionProvider } from "../apps/web/src/server/ai/mock";
import { analyzeSession, commitSession } from "../apps/web/src/server/services/import-service";
import {
  isRecommendedFor,
  recommendedIdsFor,
} from "../apps/web/src/server/services/recommend-service";
import {
  findDiscoverProfiles,
  findProfileById,
  updateProfile,
} from "../apps/web/src/server/repo/profiles";
import { toDetailView } from "../apps/web/src/server/views/profile-view";
import { runTag } from "./tags";

const criteria = (patch: Partial<IdealCriteria>): IdealCriteria => ({
  ...emptyIdealCriteria(),
  ...patch,
});

const person = (patch: Partial<RecommendSubject>): RecommendSubject => ({
  id: "x",
  gender: "MALE",
  birthYear: 1992,
  height: 178,
  residenceRegion: "SEOUL",
  workplaceRegion: null,
  religion: null,
  smoking: "NONE",
  drinking: null,
  jobCategory: "IT",
  hobbies: [],
  hashtags: [],
  criteria: null,
  ...patch,
});

describe("AI 추천 규칙 (도메인)", () => {
  it("조건마다 맞음·다름·모름을 판정하고, 모두 맞아야 만족이다", () => {
    const c = criteria({ heightMin: 175, religions: ["NONE"], regions: ["BUSAN"] });
    const result = evaluateIdeal(c, person({ height: 180, religion: null }));
    const byKey = Object.fromEntries(result.checks.map((x) => [x.key, x.outcome]));
    expect(byKey).toEqual({ height: "met", region: "unmet", religion: "unknown" });
    expect(result.meetsAll).toBe(false);
    expect(evaluateIdeal(criteria({ heightMin: 175 }), person({ height: 180 })).meetsAll).toBe(true);
  });

  it("지역은 사는 곳이나 일하는 곳 중 하나가 맞으면 맞다", () => {
    const c = criteria({ regions: ["SEOUL"] });
    const r = evaluateIdeal(c, person({ residenceRegion: "GYEONGGI", workplaceRegion: "SEOUL" }));
    expect(r.checks[0]!.outcome).toBe("met");
  });

  it("확실한 조건을 모두 만족하는 사람만 추천한다 — 모름은 만족이 아니다", () => {
    const subject = person({
      id: "s",
      gender: "FEMALE",
      criteria: criteria({ heightMin: 175, smoking: ["NONE"] }),
    });
    const fits = person({ id: "a", height: 180, smoking: "NONE" });
    const unknownSmoking = person({ id: "b", height: 180, smoking: null });
    const short = person({ id: "c", height: 170, smoking: "NONE" });
    expect(rankRecommendations(subject, [fits, unknownSmoking, short]).map((r) => r.candidateId)).toEqual([
      "a",
    ]);
  });

  it("성격·취미 키워드와 피하는 낱말은 판정에 쓰지 않는다", () => {
    const subject = person({
      id: "s",
      gender: "FEMALE",
      criteria: criteria({ heightMin: 175, keywords: ["운동"], avoidKeywords: ["문신"] }),
    });
    const tattoo = person({ id: "a", height: 180, hashtags: ["문신"] });
    const noSport = person({ id: "b", height: 180, hashtags: ["독서"] });
    expect(rankRecommendations(subject, [tattoo, noSport]).map((r) => r.candidateId).sort()).toEqual([
      "a",
      "b",
    ]);
    // 키워드만 있는 이상형은 판정할 확실한 조건이 없다.
    const vague = person({ id: "v", gender: "FEMALE", criteria: criteria({ keywords: ["다정함"] }) });
    expect(rankRecommendations(vague, [noSport])).toEqual([]);
  });

  it("상대의 「꼭」 조건에 이 분이 안 맞으면 뺀다", () => {
    const subject = person({
      id: "s",
      gender: "FEMALE",
      birthYear: 1990,
      criteria: criteria({ heightMin: 175 }),
    });
    const picky = person({ id: "a", criteria: criteria({ birthYearMin: 1993, required: ["age"] }) });
    const loose = person({ id: "b", criteria: criteria({ birthYearMin: 1993 }) });
    // 「꼭」이 아니면 상대 쪽이 어긋나도 이 분의 조건으로 정한다.
    expect(rankRecommendations(subject, [picky, loose]).map((r) => r.candidateId)).toEqual(["b"]);
  });

  it("이 분에게 확실한 조건이 없으면 상대의 조건을 이 분이 모두 만족하는 사람을 고른다", () => {
    const subject = person({ id: "s", gender: "FEMALE", birthYear: 1995, height: 163 });
    const fits = person({ id: "a", criteria: criteria({ birthYearMin: 1993 }) });
    const nope = person({ id: "b", criteria: criteria({ birthYearMax: 1990 }) });
    const silent = person({ id: "c" });
    const ranked = rankRecommendations(subject, [fits, nope, silent]);
    expect(ranked.map((r) => r.candidateId)).toEqual(["a"]);
    expect(ranked[0]!.forward).toBeNull();
  });

  it("서로 모두 만족하면 서로 맞음으로 앞에 세운다", () => {
    const subject = person({
      id: "s",
      gender: "FEMALE",
      birthYear: 1995,
      criteria: criteria({ heightMin: 175, regions: ["SEOUL"] }),
    });
    const both = person({ id: "a", criteria: criteria({ birthYearMin: 1993 }) });
    const oneWay = person({ id: "b", height: 176 });
    const ranked = rankRecommendations(subject, [oneWay, both]);
    expect(ranked.map((r) => r.candidateId)).toEqual(["a", "b"]);
    expect(ranked.map((r) => r.mutual)).toEqual([true, false]);
  });

  it("양쪽 어디에도 조건이 없으면 추천하지 않는다", () => {
    expect(rankRecommendations(person({ id: "s" }), [person({ id: "a" })])).toEqual([]);
  });
});

describe("이상형 조건 스키마", () => {
  it("뒤집힌 범위는 바로잡고, 범위 밖 숫자는 그 칸만 비운다", () => {
    const n = normalizeIdealCriteria(
      criteria({ birthYearMin: 1996, birthYearMax: 1990, heightMin: 50, heightMax: 185 }),
    );
    expect([n.birthYearMin, n.birthYearMax]).toEqual([1990, 1996]);
    expect([n.heightMin, n.heightMax]).toEqual([null, 185]);
  });

  it("적히지 않은 조건의 「꼭」은 버리고, 키워드는 해시태그 형태로 만든다", () => {
    const n = normalizeIdealCriteria(
      criteria({ smoking: ["NONE"], required: ["smoking", "height"], keywords: ["#운동 ", "운동"] }),
    );
    expect(n.required).toEqual(["smoking"]);
    expect(n.keywords).toEqual(["운동"]);
  });

  it("비선호 칸이 없던 옛 조건도 읽히고, 바라는 것과 겹치면 피하는 쪽을 믿는다", () => {
    const { avoidKeywords: _avoid, ...old } = criteria({ heightMin: 175 });
    expect(idealCriteriaSchema.parse(old).avoidKeywords).toEqual([]);
    const n = normalizeIdealCriteria(
      criteria({ keywords: ["운동", "문신"], avoidKeywords: ["#문신"] }),
    );
    expect(n.keywords).toEqual(["운동"]);
    expect(n.avoidKeywords).toEqual(["문신"]);
    expect(isIdealCriteriaEmpty(criteria({ avoidKeywords: ["문신"] }))).toBe(false);
  });

  it("견줄 것이 없으면 비어 있다고 본다", () => {
    expect(isIdealCriteriaEmpty(emptyIdealCriteria())).toBe(true);
    expect(isIdealCriteriaEmpty(criteria({ keywords: ["여행"] }))).toBe(false);
  });

  it("추출용 strict JSON Schema 에 조건 칸이 strict 규격으로 들어간다", () => {
    type Node = {
      properties?: Record<string, Node>;
      anyOf?: Node[];
      additionalProperties?: boolean;
      required?: string[];
      type?: string;
    };
    const root = toStrictJsonSchema() as Node;
    const field = root.properties!.fields!.properties!.idealCriteria!;
    const object = (field.anyOf ?? [field]).find((n) => n.type === "object")!;
    expect(object.additionalProperties).toBe(false);
    expect(object.required!.sort()).toEqual(Object.keys(object.properties!).sort());
  });
});

describe("추출이 이상형 조건을 함께 뽑는다 (mock)", () => {
  const provider = new MockExtractionProvider();

  it("글에 적힌 조건만 옮기고, 「꼭」은 그 구절에서만 읽는다", async () => {
    const { fields } = await provider.extract({
      text: "95년생 여자\n거주: 서울\n이상형: 93~96년생, 키 175 이상, 비흡연자 꼭, 운동 좋아하는 분",
    });
    const c = fields.idealCriteria!;
    expect([c.birthYearMin, c.birthYearMax]).toEqual([1993, 1996]);
    expect(c.heightMin).toBe(175);
    expect(c.smoking).toEqual(["NONE"]);
    expect(c.required).toEqual(["smoking"]);
    expect(c.keywords).toEqual(["운동"]);
  });

  it("연상·연하는 그 사람의 출생연도로 바꾸고, 출생연도를 모르면 비운다", async () => {
    const known = await provider.extract({ text: "95년생 여자\n이상형: 연상이 좋아요" });
    expect(known.fields.idealCriteria?.birthYearMax).toBe(1994);
    const unknown = await provider.extract({ text: "여자\n이상형: 연상이 좋아요" });
    expect(unknown.fields.idealCriteria).toBeNull();
  });

  it("「비선호」처럼 피하는 것은 반대로 옮기고, 옮길 수 없는 것은 피하는 것으로 남긴다", async () => {
    const { fields } = await provider.extract({
      text: "90년생 남자\n이상형: 연상, 담배, 문신 비선호 / 여행 좋아하는 분",
    });
    const c = fields.idealCriteria!;
    // 연상을 피한다 = 동갑·연하. 연상만으로 뒤집혀 들어가면 안 된다.
    expect([c.birthYearMin, c.birthYearMax]).toEqual([1990, null]);
    expect(c.smoking).toEqual(["NONE"]);
    expect(c.keywords).toEqual(["여행"]);
    expect(c.avoidKeywords).toEqual(["문신"]);
  });

  it("피한다고 적은 취향은 키워드가 되지 않는다", async () => {
    const { fields } = await provider.extract({
      text: "95년생 여자\n이상형: 키 175 이상, 운동 싫어하는 분은 별로",
    });
    expect(fields.idealCriteria?.keywords).toEqual([]);
    expect(fields.idealCriteria?.avoidKeywords).toEqual(["운동"]);
  });

  it("이상형 글이 없으면 조건도 없다", async () => {
    const { fields } = await provider.extract({ text: "95년생 여자\n거주: 서울" });
    expect(fields.idealCriteria).toBeNull();
  });
});

// ── DB ──────────────────────────────────────────────────────

const TAG = runTag("rec");
let hostA: RlsContext;
let hostB: RlsContext;
let member: RlsContext;
let groupA: string;
let groupB: string;
const ids: Record<string, string> = {};

const SUBJECT_CRITERIA = criteria({
  heightMin: 175,
  smoking: ["NONE"],
  regions: ["SEOUL"],
  required: ["smoking"],
});

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const group = async (name: string) =>
      (await sql.query<{ id: string }>(`INSERT INTO groups (name) VALUES ($1) RETURNING id`, [name]))
        .rows[0]!.id;
    const gA = await group(`${TAG}a`);
    const gB = await group(`${TAG}b`);
    const admin = async (n: string, g: string) => {
      const u = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}-${n}@test.local`, `${TAG}${n}`],
      );
      await sql.query(
        `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
        [g, u.rows[0]!.id],
      );
      return u.rows[0]!.id;
    };
    const a = await admin("a", gA);
    const b = await admin("b", gB);

    const profile = async (p: {
      group: string;
      gender: string;
      birthYear: number;
      height?: number;
      smoking?: string;
      status?: string;
      ideal?: IdealCriteria;
    }) =>
      (
        await sql.query<{ id: string }>(
          `INSERT INTO profiles (group_id, gender, birth_year, height, smoking, residence_region,
                                 ideal_criteria, status, created_by)
           VALUES ($1, $2, $3, $4, $5, 'SEOUL', $6, $7, $8) RETURNING id`,
          [
            p.group,
            p.gender,
            p.birthYear,
            p.height ?? null,
            p.smoking ?? null,
            p.ideal ?? null,
            p.status ?? "ACTIVE",
            p.group === gA ? a : b,
          ],
        )
      ).rows[0]!.id;

    return {
      gA,
      gB,
      a,
      b,
      subject: await profile({ group: gA, gender: "FEMALE", birthYear: 1994, ideal: SUBJECT_CRITERIA }),
      match: await profile({
        group: gA,
        gender: "MALE",
        birthYear: 1992,
        height: 180,
        smoking: "NONE",
        ideal: criteria({ birthYearMin: 1993, regions: ["SEOUL"] }),
      }),
      smoker: await profile({ group: gA, gender: "MALE", birthYear: 1991, height: 182, smoking: "REGULAR" }),
      inactive: await profile({
        group: gA,
        gender: "MALE",
        birthYear: 1992,
        height: 180,
        smoking: "NONE",
        status: "INACTIVE",
      }),
      sameGender: await profile({ group: gA, gender: "FEMALE", birthYear: 1993, height: 176 }),
      tooShort: await profile({ group: gA, gender: "MALE", birthYear: 1994, height: 168, smoking: "NONE" }),
      otherGroup: await profile({ group: gB, gender: "MALE", birthYear: 1992, height: 180, smoking: "NONE" }),
    };
  });

  groupA = fixture.gA;
  groupB = fixture.gB;
  hostA = { userId: fixture.a, role: "ADMIN" };
  hostB = { userId: fixture.b, role: "ADMIN" };
  Object.assign(ids, fixture);
  // 이 분 본인의 멤버 계정. 「AI 추천」은 보는 멤버가 있어야 뜻이 있다.
  const memberId = await withOwner(async (sql) => {
    const u = await sql.query<{ id: string }>(
      `INSERT INTO users (role, display_name) VALUES ('MEMBER', $1) RETURNING id`,
      [`${TAG}m`],
    );
    await sql.query(`UPDATE profiles SET user_id = $1 WHERE id = $2`, [u.rows[0]!.id, ids.subject]);
    return u.rows[0]!.id;
  });
  member = { userId: memberId, role: "MEMBER" };
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM import_sessions WHERE group_id = ANY($1)`, [[groupA, groupB]]);
    await sql.query(`DELETE FROM profiles WHERE group_id = ANY($1)`, [[groupA, groupB]]);
    await sql.query(`DELETE FROM groups WHERE id = ANY($1)`, [[groupA, groupB]]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("AI 추천 — 멤버 탐색", () => {
  it("이상형에 맞는 분만 고르고, 「꼭」이 다른 분·조건이 모자란 분·비활성·같은 성별·다른 모임은 빠진다", async () => {
    const set = await withRls(member, (sql) => recommendedIdsFor(sql, ids.subject!));
    expect([...set]).toEqual([ids.match]);
  });

  it("「AI 추천만」은 목록과 총 인원이 같은 집합을 본다", async () => {
    const page = await withRls(member, async (sql) => {
      const set = await recommendedIdsFor(sql, ids.subject!);
      return findDiscoverProfiles(sql, discoverQuerySchema.parse({ ai: "1" }), ids.subject!, {
        onlyIds: [...set],
      });
    });
    expect(page.items.map((p) => p.id)).toEqual([ids.match]);
    expect(page.total).toBe(1);
    const all = await withRls(member, (sql) =>
      findDiscoverProfiles(sql, discoverQuerySchema.parse({}), ids.subject!),
    );
    expect(all.total).toBe(3);
  });

  it("상세의 표시도 같은 판정이다", async () => {
    const result = await withRls(member, async (sql) => ({
      match: await isRecommendedFor(sql, ids.subject!, (await findProfileById(sql, ids.match!))!),
      smoker: await isRecommendedFor(sql, ids.subject!, (await findProfileById(sql, ids.smoker!))!),
    }));
    expect(result).toEqual({ match: true, smoker: false });
  });

  it("숨긴 사이는 추천에서도 빠진다", async () => {
    await withOwner((sql) =>
      sql.query(`INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1, $2)`, [
        ids.match,
        ids.subject,
      ]),
    );
    try {
      const set = await withRls(member, (sql) => recommendedIdsFor(sql, ids.subject!));
      expect(set.size).toBe(0);
    } finally {
      await withOwner((sql) =>
        sql.query(`DELETE FROM profile_hides WHERE hider_profile_id = $1`, [ids.match]),
      );
    }
  });

  it("멤버 프로필이 없는 세션에는 추천이 없다", async () => {
    const set = await withRls(hostA, (sql) => recommendedIdsFor(sql, null));
    expect(set.size).toBe(0);
  });
});

describe("이상형 조건 — 프로필 항목", () => {
  it("멤버에게 나가는 상세에는 조건이 실리지 않는다", async () => {
    const record = await withRls(hostA, (sql) => findProfileById(sql, ids.subject!));
    expect(record!.idealCriteria).toEqual(SUBJECT_CRITERIA);
    const view = toDetailView(record!, "DETAIL") as Record<string, unknown>;
    expect("idealCriteria" in view).toBe(false);
  });

  it("다른 칸만 고치면 조건은 그대로 남고, 보내면 정리해서 저장한다", async () => {
    await withRls(hostA, (sql) =>
      updateProfile(sql, ids.subject!, profileUpdateSchema.parse({ bio: "합성 소개" })),
    );
    let record = await withRls(hostA, (sql) => findProfileById(sql, ids.subject!));
    expect(record!.idealCriteria).toEqual(SUBJECT_CRITERIA);

    await withRls(hostA, (sql) =>
      updateProfile(
        sql,
        ids.subject!,
        profileUpdateSchema.parse({ idealCriteria: criteria({ heightMin: 190, heightMax: 170 }) }),
      ),
    );
    record = await withRls(hostA, (sql) => findProfileById(sql, ids.subject!));
    expect([record!.idealCriteria?.heightMin, record!.idealCriteria?.heightMax]).toEqual([170, 190]);

    await withRls(hostA, (sql) =>
      updateProfile(sql, ids.subject!, profileUpdateSchema.parse({ idealCriteria: SUBJECT_CRITERIA })),
    );
  });

  it("DB 는 객체가 아닌 값을 받지 않는다", async () => {
    await expect(
      withOwner((sql) =>
        sql.query(`UPDATE profiles SET ideal_criteria = '[]'::jsonb WHERE id = $1`, [ids.subject]),
      ),
    ).rejects.toThrow();
  });

  it("가져오기에서 등록하면 추출이 뽑은 조건이 프로필에 저장된다", async () => {
    const sessionId = await withRls(hostA, async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO import_sessions (group_id, created_by, source, raw_text)
         VALUES ($1, $2, 'TEXT', $3) RETURNING id`,
        [
          groupA,
          hostA.userId,
          "96년생 여자\n거주: 서울\n이상형: 키 178 이상, 비흡연자 꼭, 여행 좋아하는 분",
        ],
      );
      return r.rows[0]!.id;
    });
    await analyzeSession(hostA, sessionId);
    const { profileId } = await commitSession(hostA, {
      sessionId,
      idempotencyKey: `${TAG}-ideal`,
      publish: false,
    });
    const record = await withRls(hostA, (sql) => findProfileById(sql, profileId));
    expect(record!.idealCriteria).toMatchObject({
      heightMin: 178,
      smoking: ["NONE"],
      required: ["smoking"],
      keywords: ["여행"],
    });
  });
});
