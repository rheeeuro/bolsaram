/**
 * 가져오기 원문 중복 차단 통합 테스트.
 * 같은 원문(보이는 글자 기준)은 주선자를 가리지 않고 두 번 받지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { analyzeSession, commitSession } from "../apps/web/src/server/services/import-service";
import { createSession, updateRawText } from "../apps/web/src/server/repo/imports";
import { runTag } from "./tags";

const TAG = runTag("dup");
let owner: RlsContext;
let other: RlsContext;
let groupId: string;

/** 실행마다 다른 원문이어야 앞선 실행이 남긴 행과 섞이지 않는다. */
const SAMPLE = [`${TAG} 93년생 여자`, "키 167cm", "직업: 마케터", "거주: 서울"].join("\n");

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(`INSERT INTO groups (name) VALUES ($1) RETURNING id`, [
      TAG,
    ]);
    const ids: string[] = [];
    for (const suffix of ["a", "b"]) {
      const user = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}${suffix}@test.local`, `${TAG}${suffix}`],
      );
      ids.push(user.rows[0]!.id);
      await sql.query(`INSERT INTO group_admins (group_id, user_id) VALUES ($1, $2)`, [
        g.rows[0]!.id,
        user.rows[0]!.id,
      ]);
    }
    return { group: g.rows[0]!.id, ids };
  });
  groupId = fixture.group;
  owner = { userId: fixture.ids[0]!, role: "ADMIN" };
  other = { userId: fixture.ids[1]!, role: "ADMIN" };
});

afterAll(async () => {
  await withOwner(async (sql) => {
    const users = [owner.userId, other.userId];
    await sql.query(`DELETE FROM import_sessions WHERE created_by = ANY($1)`, [users]);
    await sql.query(`DELETE FROM profiles WHERE created_by = ANY($1)`, [users]);
    await sql.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  });
  await closePools();
});

function upload(ctx: RlsContext, rawText?: string): Promise<string> {
  return withRls(ctx, async (sql) => {
    const session = await createSession(sql, {
      groupId,
      createdBy: ctx.userId,
      source: "TEXT",
      ...(rawText ? { rawText } : {}),
    });
    return session.id;
  });
}

describe("원문 중복 차단", () => {
  it("같은 글은 두 번 받지 않는다 — 공백·줄바꿈·카카오톡 말머리가 달라도", async () => {
    const text = `${SAMPLE}\n말머리`;
    await upload(owner, text);
    await expect(upload(owner, text)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      upload(owner, `[주선자] [오후 3:12] ${text.replace(/\n/g, "\r\n\r\n")}  ​`),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/검토 대기/),
    });
  });

  it("글자가 하나라도 다르면 받는다", async () => {
    await upload(owner, `${SAMPLE}\n취미: 러닝`);
    await expect(upload(owner, `${SAMPLE}\n취미: 등산`)).resolves.toEqual(expect.any(String));
  });

  it("짧은 글과 글 없는 업로드는 견주지 않는다", async () => {
    await upload(owner, "사진입니다");
    await expect(upload(owner, "사진입니다")).resolves.toEqual(expect.any(String));
    await upload(owner);
    await expect(upload(owner)).resolves.toEqual(expect.any(String));
  });

  it("원문을 고쳐 같은 글로 만드는 것도 막는다 — 자기 자신은 빼고", async () => {
    const text = `${SAMPLE}\n편집`;
    await upload(owner, text);
    const second = await upload(owner, `${SAMPLE}\n편집 전`);
    await expect(withRls(owner, (sql) => updateRawText(sql, second, text))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // 같은 내용을 다시 저장하는 것은 막지 않는다.
    await expect(
      withRls(owner, (sql) => updateRawText(sql, second, `${SAMPLE}\n편집 전`)),
    ).resolves.toBeTruthy();
  });

  it("등록된 프로필과 같은 글이면 그 번호를 알려준다", async () => {
    const text = `${SAMPLE}\n등록 확인`;
    const registered = await upload(owner, text);
    await analyzeSession(owner, registered);
    const committed = await commitSession(owner, {
      sessionId: registered,
      idempotencyKey: `${TAG}-commit`,
      publish: false,
    });
    const code = await withOwner(async (sql) => {
      const row = await sql.query<{ public_code: number }>(
        `SELECT public_code FROM profiles WHERE id = $1`,
        [committed.profileId],
      );
      return row.rows[0]!.public_code;
    });
    await expect(upload(owner, text)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(`${code}번 프로필`),
      details: { duplicateSessionId: registered, duplicateProfileId: committed.profileId },
    });
  });

  it("동시에 두 번 보내도 하나만 남는다", async () => {
    const text = `${SAMPLE}\n동시`;
    const results = await Promise.allSettled([upload(owner, text), upload(owner, text)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("다른 주선자가 올린 글도 막되, 누구의 무엇인지는 알려주지 않는다", async () => {
    // 가져오기는 올린 주선자만 본다(import_sessions_admin). 거절은 하되 그 세션·프로필을
    // 가리키는 값이 응답에 실리면 남의 데이터로 가는 길이 된다.
    const text = `${SAMPLE}\n남의 것`;
    const theirs = await upload(owner, text);
    const rejected = await upload(other, text).catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: "CONFLICT", message: "다른 주선자가 이미 올린 프로필 글입니다." });
    expect((rejected as { details?: unknown }).details).toBeUndefined();
    expect(JSON.stringify(rejected)).not.toContain(theirs);
    // 원문을 고쳐 같게 만드는 길도 같다.
    const mine = await upload(other, `${SAMPLE}\n남의 것 아님`);
    await expect(withRls(other, (sql) => updateRawText(sql, mine, text))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("같은 글 확인 함수는 주선자만 부른다", async () => {
    const member: RlsContext = { userId: other.userId, role: "MEMBER" };
    await expect(
      withRls(member, (sql) =>
        sql.query(`SELECT app_import_raw_text_taken($1, NULL)`, [`${SAMPLE}\n남의 것`]),
      ),
    ).rejects.toThrow(/주선자만/);
  });
});
