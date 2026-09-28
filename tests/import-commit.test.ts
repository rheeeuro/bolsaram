/**
 * Import commit 통합 테스트 (부트스트랩 §12 「commit idempotency」).
 * 실제 DB 에 붙어 같은 세션이 프로필을 두 개 만들지 않는지 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { commitSession, analyzeSession } from "../apps/web/src/server/services/import-service";
import {
  countInbox,
  latestExtraction,
  listInbox,
  requireSession,
} from "../apps/web/src/server/repo/imports";
import { runTag } from "./tags";

const TAG = runTag("cmt");
let admin: RlsContext;

const SAMPLE_TEXT = [
  "93년생 여자",
  "키 167cm",
  "직업: 마케터",
  "회사: 가온컴퍼니",
  "학력: OO대학교 학사",
  "거주: 서울",
  "직장: 서울",
  "종교: 무교",
  "MBTI: ENFP",
  "비흡연, 술은 가끔",
  "취미: 러닝, 전시, 커피",
  "자기소개: 합성 데이터입니다.",
  "이상형: 대화가 잘 통하는 분",
].join("\n");

/** 주선자는 모임에 속해야 아무것도 할 수 없다 — RLS 가 group_admins 로 판정한다. */
let groupId: string;

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const group = g.rows[0]!.id;
    const result = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, display_name)
       VALUES ('ADMIN', $1, $2) RETURNING id`,
      [`${TAG}@test.local`, TAG],
    );
    const userId = result.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
      [group, userId],
    );
    return { group, userId };
  });
  groupId = fixture.group;
  admin = { userId: fixture.userId, role: "ADMIN" };
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM import_sessions WHERE created_by = $1`, [admin.userId]);
    await sql.query(`DELETE FROM profiles WHERE created_by = $1`, [admin.userId]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [admin.userId]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  });
  await closePools();
});

async function newSession(rawText: string | null): Promise<string> {
  return withRls(admin, async (sql) => {
    const result = await sql.query<{ id: string }>(
      `INSERT INTO import_sessions (group_id, created_by, source, raw_text)
       VALUES ($1, $2, 'TEXT', $3) RETURNING id`,
      [groupId, admin.userId, rawText],
    );
    return result.rows[0]!.id;
  });
}

describe("analyze", () => {
  it("추출 결과를 저장하고 검토 단계로 넘긴다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    const result = await analyzeSession(admin, id);
    expect(["READY", "REVIEW_REQUIRED"]).toContain(result.status);

    const extraction = await withRls(admin, (sql) => latestExtraction(sql, id));
    expect(extraction?.fields.gender).toBe("FEMALE");
    expect(extraction?.fields.birthYear).toBe(1993);
    // AI 결과만으로는 절대 IMPORTED 가 되지 않는다.
    const session = await withRls(admin, (sql) => requireSession(sql, id));
    expect(session.status).not.toBe("IMPORTED");
  });

  it("원문이 없으면 거부한다", async () => {
    // 사진은 모델에 보내지 않으므로 원문이 유일한 근거다(ai/types.ts).
    // 사진만 있는 세션도 여기서 막혀야 한다 — 분석해도 전부 null 이 나온다.
    const id = await newSession(null);
    await expect(analyzeSession(admin, id)).rejects.toThrow(/분석할 원문이 없습니다/);
  });

  it("여러 번 분석해도 최신 결과가 쓰인다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);
    await analyzeSession(admin, id);
    const rows = await withRls(admin, (sql) =>
      sql.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM import_extractions WHERE import_session_id = $1`,
        [id],
      ),
    );
    // 이력은 쌓이되 최신 하나만 유효하다.
    expect(rows.rows[0]!.count).toBe(2);
  });
});

describe("commit idempotency", () => {
  it("같은 키로 두 번 호출해도 프로필은 하나다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);

    const key = `idem-${id}`;
    const first = await commitSession(admin, {
      sessionId: id,
      idempotencyKey: key,
      publish: false,
    });
    const second = await commitSession(admin, {
      sessionId: id,
      idempotencyKey: key,
      publish: false,
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.profileId).toBe(first.profileId);

    const count = await withRls(admin, (sql) =>
      sql.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM profiles WHERE id = $1`,
        [first.profileId],
      ),
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it("동시 호출에서도 프로필이 하나만 생긴다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        commitSession(admin, {
          sessionId: id,
          idempotencyKey: `race-${id}-${i}`,
          publish: false,
        }),
      ),
    );
    const succeeded = results.filter(
      (r): r is PromiseFulfilledResult<{ profileId: string; reused: boolean }> =>
        r.status === "fulfilled",
    );
    // 성공한 것들은 모두 같은 프로필을 가리켜야 한다.
    const ids = new Set(succeeded.map((r) => r.value.profileId));
    expect(ids.size).toBe(1);

    const session = await withRls(admin, (sql) => requireSession(sql, id));
    expect(session.status).toBe("IMPORTED");
  });

  it("등록된 세션은 다시 등록할 수 없다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);
    await commitSession(admin, { sessionId: id, idempotencyKey: `once-${id}`, publish: false });

    await expect(
      commitSession(admin, { sessionId: id, idempotencyKey: `twice-${id}`, publish: false }),
    ).resolves.toMatchObject({ reused: true });
  });

  it("추출한 해시태그를 정규화해 저장한다", async () => {
    const id = await newSession(`${SAMPLE_TEXT}\n#등산 #카페투어 #등산`);
    await analyzeSession(admin, id);
    const result = await commitSession(admin, {
      sessionId: id,
      idempotencyKey: `tags-${id}`,
      publish: false,
    });

    const row = await withRls(admin, (sql) =>
      sql.query<{ hashtags: string[] }>(`SELECT hashtags FROM profiles WHERE id = $1`, [
        result.profileId,
      ]),
    );
    const tags = row.rows[0]!.hashtags;
    // `#`·공백 없이, 중복 없이 들어간다 — 검색 쿼리와 같은 형태다.
    expect(tags.slice(0, 2)).toEqual(["등산", "카페투어"]);
    for (const tag of tags) expect(tag).not.toMatch(/[#\s]/);
  });

  it("정규화되지 않은 태그는 DB 가 거부한다", async () => {
    // 애플리케이션을 우회해도 같은 태그가 둘로 갈리지 않는다(0047).
    await expect(
      withOwner((sql) =>
        sql.query(
          `INSERT INTO profiles (gender, birth_year, residence_region, hashtags, created_by)
           VALUES ('FEMALE', 1993, 'SEOUL', ARRAY['#등산'], $1)`,
          [admin.userId],
        ),
      ),
    ).rejects.toThrow(/profiles_hashtags_shape/);
  });

  it("기본 등록은 비공개 상태로 만든다 — 자동 게시하지 않는다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);
    const result = await commitSession(admin, {
      sessionId: id,
      idempotencyKey: `unpub-${id}`,
      publish: false,
    });

    const row = await withRls(admin, (sql) =>
      sql.query<{ status: string }>(
        `SELECT status::text FROM profiles WHERE id = $1`,
        [result.profileId],
      ),
    );
    expect(row.rows[0]).toEqual({ status: "INACTIVE" });
  });

  it("확인이 필요한 상태에서는 공개 등록을 막는다", async () => {
    // 성별을 알 수 없는 글 → REVIEW_REQUIRED
    const id = await newSession("키 170cm 서울 거주 1990년생");
    await analyzeSession(admin, id);
    await expect(
      commitSession(admin, { sessionId: id, idempotencyKey: `pub-${id}`, publish: true }),
    ).rejects.toThrow(/필수 항목|바로 공개할 수 없습니다/);
  });
});

/**
 * 이름·연락 방법은 추출 결과가 아니라 주선자가 검토 화면에서 확인한 값으로 받는다.
 * 초대 전에 채워야 하는 칸이라 등록과 함께 들어가야 편집 화면에서 다시 치지 않는다.
 */
describe("등록과 함께 받는 이름·연락 방법", () => {
  it("검토 화면에서 확인한 값으로 프로필을 만든다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);
    const result = await commitSession(admin, {
      sessionId: id,
      idempotencyKey: `hidden-${id}`,
      publish: false,
      realName: "  김볼사 ",
      contactNote: "카카오톡 ID bolsa",
    });

    const row = await withRls(admin, (sql) =>
      sql.query<{ real_name: string | null; contact_note: string | null }>(
        `SELECT real_name, contact_note FROM profiles WHERE id = $1`,
        [result.profileId],
      ),
    );
    expect(row.rows[0]).toEqual({ real_name: "김볼사", contact_note: "카카오톡 ID bolsa" });
  });

  it("비워 두면 적지 않은 것으로 둔다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);
    const result = await commitSession(admin, {
      sessionId: id,
      idempotencyKey: `blank-${id}`,
      publish: false,
      realName: "   ",
    });
    const row = await withRls(admin, (sql) =>
      sql.query<{ real_name: string | null }>(`SELECT real_name FROM profiles WHERE id = $1`, [
        result.profileId,
      ]),
    );
    expect(row.rows[0]).toEqual({ real_name: null });
  });
});

/** 가져오기 목록은 할 일과 끝난 일을 나눠 읽는다 — 끝난 건이 할 일을 묻지 않게. */
describe("가져오기 목록 칸", () => {
  it("등록하면 검토 대기에서 빠지고 등록됨에 번호와 요약이 붙어 나온다", async () => {
    const id = await newSession(SAMPLE_TEXT);
    await analyzeSession(admin, id);

    const before = await withRls(admin, (sql) => listInbox(sql, { groupId, done: false }));
    const pending = before.find((item) => item.id === id);
    expect(pending?.summary?.birthYear).toBe(1993);

    await commitSession(admin, { sessionId: id, idempotencyKey: `inbox-${id}`, publish: false });

    const { pendingIds, doneItem, counts } = await withRls(admin, async (sql) => ({
      pendingIds: (await listInbox(sql, { groupId, done: false })).map((item) => item.id),
      doneItem: (await listInbox(sql, { groupId, done: true })).find((item) => item.id === id),
      counts: await countInbox(sql, groupId),
    }));
    expect(pendingIds).not.toContain(id);
    expect(doneItem?.profileCode).toEqual(expect.any(Number));
    expect(counts.done).toBeGreaterThan(0);
    expect(counts.pending).toBe(pendingIds.length);
  });
});
