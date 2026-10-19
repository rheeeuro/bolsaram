/**
 * 텔레그램 「새 사람으로 나누기」 통합 테스트.
 *
 * webhook 부터 버튼까지 실제 어댑터를 돌리고 Bot API 호출만 가짜로 바꾼다.
 * 판정기(Decisions API)도 갈아끼운다 — 외부 모델을 부르지 않는다.
 *
 *   * 이어 온 글이 다른 사람 같으면 묻기만 하고, 누르면 두 대화로 나눈다.
 *   * 같은 사람 같으면 묻지 않는다(지금처럼 이어 붙은 채로 둔다).
 *   * 같은 버튼을 다시 누르거나, 다음 사람을 이미 받고 있으면 나누지 않는다.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const bot = vi.hoisted(() => ({
  sent: [] as { text: string; rows?: { text: string; data?: string }[][] }[],
  answered: [] as (string | undefined)[],
}));
vi.mock("../apps/web/src/server/telegram/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apps/web/src/server/telegram/client")>()),
  sendMessage: vi.fn(
    async (_chatId: number, text: string, options: { rows?: (typeof bot.sent)[number]["rows"] } = {}) => {
      bot.sent.push({ text, ...(options.rows ? { rows: options.rows } : {}) });
    },
  ),
  answerCallbackQuery: vi.fn(async (_id: string, text?: string) => {
    bot.answered.push(text);
  }),
  editMessageReplyMarkup: vi.fn(async () => {}),
}));

import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { setContinuationJudge } from "../apps/web/src/server/ai/index";
import {
  consumeTelegramLinkCode,
  issueTelegramLinkCode,
} from "../apps/web/src/server/auth/telegram";
import { findSession } from "../apps/web/src/server/repo/imports";
import {
  findActiveConversation,
  findConversationByImportSession,
} from "../apps/web/src/server/repo/telegram";
import { handleTelegramUpdate } from "../apps/web/src/server/telegram/adapter";
import { messages } from "../apps/web/src/server/telegram/messages";
import { runTag } from "./tags";

const TAG = runTag("tgs");
const UPDATE_BASE = 800_000_000 + Math.floor(Math.random() * 1_000_000);
/** 합성 텔레그램 계정 id. 실제 계정과 무관하다. */
const TG = UPDATE_BASE + 1;
let nextUpdateId = UPDATE_BASE + 100;

const FIRST = "93년생 여자 / 165cm\n분당 거주, 판교 개발자\n합성 데이터입니다.";
const SECOND = "90년생 남자 / 182cm\n강남 거주, 회계사\n합성 데이터입니다.";

let admin: RlsContext;
let groupId: string;

beforeAll(async () => {
  const ids = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(`INSERT INTO groups (name) VALUES ($1) RETURNING id`, [
      TAG,
    ]);
    const a = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
      [`${TAG}@test.local`, TAG],
    );
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
      [g.rows[0]!.id, a.rows[0]!.id],
    );
    return { group: g.rows[0]!.id, adminId: a.rows[0]!.id };
  });
  groupId = ids.group;
  admin = { userId: ids.adminId, role: "ADMIN" };
  const issued = await issueTelegramLinkCode(ids.adminId);
  await consumeTelegramLinkCode({ code: issued.code, telegramUserId: TG, telegramChatId: TG });
});

afterEach(() => {
  setContinuationJudge(undefined);
  bot.sent.length = 0;
  bot.answered.length = 0;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM telegram_webhook_events WHERE update_id BETWEEN $1 AND $2`, [
      UPDATE_BASE,
      nextUpdateId,
    ]);
    await sql.query(`DELETE FROM users WHERE display_name = $1`, [TAG]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  });
  await closePools();
});

const text = (value: string) =>
  handleTelegramUpdate({
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      from: { id: TG },
      chat: { id: TG, type: "private" },
      date: 1,
      text: value,
    },
  });

const press = (data: string) =>
  handleTelegramUpdate({
    update_id: nextUpdateId++,
    callback_query: {
      id: `cb-${nextUpdateId}`,
      from: { id: TG },
      message: { message_id: 1, chat: { id: TG, type: "private" } },
      data,
    },
  });

async function activeSession() {
  return withRls(admin, async (sql) => {
    const active = await findActiveConversation(sql, TG);
    return active ? findSession(sql, active.importSessionId) : null;
  });
}

/** 뒤에서 도는 분석이 끝날 때까지 기다린다 — 끝나기 전에 지우면 그쪽이 실패한다. */
async function settled(sessionId: string) {
  await vi.waitFor(
    async () => {
      const session = await withRls(admin, (sql) => findSession(sql, sessionId));
      expect(session?.status).not.toBe("ANALYZING");
    },
    { timeout: 5_000 },
  );
}

async function splitButton(): Promise<string> {
  await vi.waitFor(() => {
    expect(bot.sent.some((m) => m.text === messages.splitSuggest)).toBe(true);
  });
  const data = bot.sent.find((m) => m.text === messages.splitSuggest)?.rows?.[0]?.[0]?.data;
  expect(data).toMatch(/^s:/);
  return data!;
}

describe("새 사람으로 나누기", () => {
  it("다른 사람 같으면 묻고, 누르면 앞 사람과 새 사람의 대화로 나눈다", async () => {
    const judge = vi.fn(async () => 0.97);
    setContinuationJudge({ differentPerson: judge });
    await text("/new");
    await text(FIRST);
    await text(SECOND);
    const data = await splitButton();
    expect(judge).toHaveBeenCalledWith({ previous: FIRST, incoming: SECOND });

    const before = (await activeSession())!;
    expect(before.rawText).toBe(`${FIRST}\n\n${SECOND}`);

    await press(data);
    expect(bot.answered).toContain(messages.splitDone);

    const after = (await activeSession())!;
    expect(after.id).not.toBe(before.id);
    expect(after.rawText).toBe(SECOND);
    const kept = await withRls(admin, async (sql) => ({
      session: await findSession(sql, before.id),
      conversation: await findConversationByImportSession(sql, before.id),
    }));
    expect(kept.session?.rawText).toBe(FIRST);
    expect(kept.conversation?.state).toBe("COMPLETED");

    await settled(before.id);
    await settled(after.id);
  });

  it("같은 버튼을 다시 눌러도 두 번 나누지 않는다", async () => {
    setContinuationJudge({ differentPerson: async () => 0.97 });
    await text("/new");
    await text(FIRST.replace("165", "161"));
    await text(SECOND.replace("182", "181"));
    const data = await splitButton();
    await press(data);
    const split = (await activeSession())!;

    await press(data);
    expect(bot.answered.at(-1)).toBe(messages.splitStale);
    expect((await activeSession())!.id).toBe(split.id);
    await settled(split.id);
  });

  it("다음 사람을 이미 받고 있으면 나누지 않는다", async () => {
    setContinuationJudge({ differentPerson: async () => 0.97 });
    await text("/new");
    await text(FIRST.replace("165", "162"));
    await text(SECOND.replace("182", "183"));
    const data = await splitButton();
    const merged = (await activeSession())!;
    await settled(merged.id);

    await text("/new");
    await press(data);
    expect(bot.answered.at(-1)).toBe(messages.splitBusy);
    const untouched = await withRls(admin, (sql) => findSession(sql, merged.id));
    expect(untouched?.rawText).toBe(merged.rawText);
  });

  it("같은 사람 같으면 묻지 않는다", async () => {
    const judge = vi.fn(async () => 0.74);
    setContinuationJudge({ differentPerson: judge });
    await text("/new");
    await text(FIRST.replace("165", "163"));
    await text("이상형: 다정하고 웃음 많은 분");
    await vi.waitFor(() => expect(judge).toHaveBeenCalled());
    const session = (await activeSession())!;
    await settled(session.id);
    expect(bot.sent.some((m) => m.text === messages.splitSuggest)).toBe(false);
  });
});
