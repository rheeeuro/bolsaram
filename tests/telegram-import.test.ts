/**
 * 텔레그램 Import 통합 테스트
 * (설계 변경 문서 TELEGRAM v1 §18 「Webhook」·「Import」·「Security」).
 *
 * 실제 Postgres 에 붙어 다음을 확인한다.
 *   * 같은 webhook update 가 두 번 와도 한 번만 처리된다.
 *   * 연결되지 않은 텔레그램 계정은 아무것도 못 한다.
 *   * 연결 코드는 한 번만 쓰이고 만료된다.
 *   * 사진 여러 장이 하나의 ImportSession 에 순서대로 묶인다.
 *   * 봇 전용 테이블에 런타임 롤이 접근하지 못한다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import {
  claimTelegramUpdate,
  consumeTelegramLinkCode,
  findTelegramIdentity,
  issueTelegramLinkCode,
  markTelegramUpdateProcessed,
} from "../apps/web/src/server/auth/telegram";
import {
  createConversation,
  deleteConnectionForUser,
  expireStaleConversations,
  findActiveConversation,
  findConnectionForUser,
  findConversationByImportSession,
  updateConversation,
} from "../apps/web/src/server/repo/telegram";
import {
  appendUploadedAsset,
  createSession,
  listAssets,
} from "../apps/web/src/server/repo/imports";

const TAG = `tgtest-${Date.now()}`;
/** 다른 테스트와 겹치지 않도록 높은 대역을 쓴다. */
const UPDATE_BASE = 900_000_000 + Math.floor(Math.random() * 1_000_000);
/** 텔레그램 사용자 id 도 합성값이다. 실제 계정과 무관하다. */
const TG_ADMIN = UPDATE_BASE + 1;
const TG_MEMBER = UPDATE_BASE + 2;
const TG_STRANGER = UPDATE_BASE + 3;

let adminId: string;
let memberId: string;
let admin: RlsContext;
let member: RlsContext;

beforeAll(async () => {
  const ids = await withOwner(async (sql) => {
    const a = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
      [`${TAG}-admin@test.local`, `${TAG}-admin`],
    );
    const m = await sql.query<{ id: string }>(
      `INSERT INTO users (role, phone, display_name)
       VALUES ('MEMBER', $1, $2) RETURNING id`,
      [`0109${String(UPDATE_BASE).slice(-7)}`, `${TAG}-member`],
    );
    return { adminId: a.rows[0]!.id, memberId: m.rows[0]!.id };
  });
  adminId = ids.adminId;
  memberId = ids.memberId;
  admin = { userId: adminId, role: "ADMIN" };
  member = { userId: memberId, role: "MEMBER" };
});

afterAll(async () => {
  // 자기가 만든 것만 지운다. users 삭제로 연결·코드·Import 세션이 CASCADE 된다.
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM telegram_webhook_events WHERE update_id BETWEEN $1 AND $2`, [
      UPDATE_BASE,
      UPDATE_BASE + 1000,
    ]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("webhook 재전송", () => {
  it("같은 update_id 는 한 번만 처리 대상이 된다", async () => {
    const id = UPDATE_BASE + 10;
    expect(await claimTelegramUpdate(id, "message")).toBe(true);
    // 텔레그램은 응답이 늦으면 같은 update 를 다시 보낸다. 사진이 두 번 저장되면 안 된다.
    expect(await claimTelegramUpdate(id, "message")).toBe(false);
    expect(await claimTelegramUpdate(id, "message")).toBe(false);
  });

  it("서로 다른 update 는 각각 처리된다", async () => {
    expect(await claimTelegramUpdate(UPDATE_BASE + 11, "message")).toBe(true);
    expect(await claimTelegramUpdate(UPDATE_BASE + 12, "message")).toBe(true);
  });

  it("처리 완료를 기록한다", async () => {
    const id = UPDATE_BASE + 13;
    await claimTelegramUpdate(id, "message");
    await markTelegramUpdateProcessed(id);
    const processed = await withOwner(async (sql) => {
      const r = await sql.query<{ processed_at: Date | null }>(
        `SELECT processed_at FROM telegram_webhook_events WHERE update_id = $1`,
        [id],
      );
      return r.rows[0]?.processed_at;
    });
    expect(processed).not.toBeNull();
  });
});

describe("계정 연결", () => {
  it("연결되지 않은 텔레그램 계정은 신원이 없다", async () => {
    // 봇은 검색으로 누구나 찾을 수 있다. 여기서 null 이면 아무것도 하지 못한다.
    expect(await findTelegramIdentity(TG_STRANGER)).toBeNull();
  });

  it("코드로 연결하면 주선자 신원을 얻는다", async () => {
    const issued = await issueTelegramLinkCode(adminId, "BolsaramTestBot");
    expect(issued.deepLink).toContain(issued.code);

    const identity = await consumeTelegramLinkCode({
      code: issued.code,
      telegramUserId: TG_ADMIN,
      telegramChatId: TG_ADMIN,
    });
    expect(identity).toMatchObject({ userId: adminId, role: "ADMIN" });
    expect(await findTelegramIdentity(TG_ADMIN)).toMatchObject({ userId: adminId });
  });

  it("같은 코드를 두 번 쓸 수 없다", async () => {
    const issued = await issueTelegramLinkCode(adminId);
    await consumeTelegramLinkCode({
      code: issued.code,
      telegramUserId: TG_ADMIN,
      telegramChatId: TG_ADMIN,
    });
    await expect(
      consumeTelegramLinkCode({
        code: issued.code,
        telegramUserId: TG_ADMIN,
        telegramChatId: TG_ADMIN,
      }),
    ).rejects.toThrow(/이미 사용된/);
  });

  it("만료된 코드는 쓸 수 없다", async () => {
    const issued = await issueTelegramLinkCode(adminId);
    await withOwner((sql) =>
      sql.query(
        `UPDATE telegram_link_codes SET expires_at = now() - interval '1 minute'
          WHERE user_id = $1 AND consumed_at IS NULL`,
        [adminId],
      ),
    );
    await expect(
      consumeTelegramLinkCode({
        code: issued.code,
        telegramUserId: TG_ADMIN,
        telegramChatId: TG_ADMIN,
      }),
    ).rejects.toThrow(/만료/);
  });

  it("없는 코드는 쓸 수 없다", async () => {
    await expect(
      consumeTelegramLinkCode({
        code: "존재하지-않는-코드",
        telegramUserId: TG_STRANGER,
        telegramChatId: TG_STRANGER,
      }),
    ).rejects.toThrow(/만료되었거나 이미 사용된/);
  });

  it("회원 계정으로는 봇을 연결할 수 없다", async () => {
    // 텔레그램은 주선자용 운영 채널이다(§15).
    const issued = await issueTelegramLinkCode(memberId);
    await expect(
      consumeTelegramLinkCode({
        code: issued.code,
        telegramUserId: TG_MEMBER,
        telegramChatId: TG_MEMBER,
      }),
    ).rejects.toThrow(/주선자 계정만/);
    expect(await findTelegramIdentity(TG_MEMBER)).toBeNull();
  });

  it("새 코드를 발급하면 이전 코드가 죽는다", async () => {
    const first = await issueTelegramLinkCode(adminId);
    await issueTelegramLinkCode(adminId);
    await expect(
      consumeTelegramLinkCode({
        code: first.code,
        telegramUserId: TG_ADMIN,
        telegramChatId: TG_ADMIN,
      }),
    ).rejects.toThrow(/만료되었거나 이미 사용된/);
  });

  it("연결 후 권한이 내려가면 신원을 잃는다", async () => {
    // users_member_needs_phone 제약이 있으므로 강등할 때 전화번호를 함께 넣는다.
    await withOwner((sql) =>
      sql.query(`UPDATE users SET role = 'MEMBER', phone = $2 WHERE id = $1`, [
        adminId,
        `0108${String(UPDATE_BASE).slice(-7)}`,
      ]),
    );
    // 연결은 그대로 남아 있어도 매 요청에 권한을 다시 확인하므로 통과하지 못한다.
    expect(await findTelegramIdentity(TG_ADMIN)).toBeNull();

    await withOwner((sql) =>
      sql.query(`UPDATE users SET role = 'ADMIN', phone = NULL WHERE id = $1`, [adminId]),
    );
    expect(await findTelegramIdentity(TG_ADMIN)).not.toBeNull();
  });

  it("다른 주선자에게 연결된 텔레그램 계정은 빼앗을 수 없다", async () => {
    const otherId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, password_hash, display_name)
         VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
        [`${TAG}-admin2@test.local`, `${TAG}-admin2`],
      );
      return r.rows[0]!.id;
    });
    const issued = await issueTelegramLinkCode(otherId);
    await expect(
      consumeTelegramLinkCode({
        code: issued.code,
        telegramUserId: TG_ADMIN,
        telegramChatId: TG_ADMIN,
      }),
    ).rejects.toThrow(/다른 주선자/);
  });
});

describe("대화와 사진 묶기", () => {
  async function newConversation(): Promise<{ importSessionId: string }> {
    return withRls(admin, async (sql) => {
      const session = await createSession(sql, { createdBy: adminId, source: "TELEGRAM" });
      await createConversation(sql, {
        importSessionId: session.id,
        telegramUserId: TG_ADMIN,
        telegramChatId: TG_ADMIN,
      });
      return { importSessionId: session.id };
    });
  }

  async function closeActive(): Promise<void> {
    await withRls(admin, async (sql) => {
      const active = await findActiveConversation(sql, TG_ADMIN);
      if (active) await updateConversation(sql, active, { state: "CANCELED" });
    });
  }

  it("텔레그램 사용자당 진행 중인 대화는 하나뿐이다", async () => {
    await closeActive();
    await newConversation();
    // DB 의 부분 유니크 인덱스가 두 번째 활성 대화를 막는다.
    await expect(newConversation()).rejects.toThrow();
    await closeActive();
  });

  it("사진 여러 장이 한 세션에 순서대로 묶인다", async () => {
    await closeActive();
    const { importSessionId } = await newConversation();

    await withRls(admin, async (sql) => {
      for (const name of ["a", "b", "c"]) {
        await appendUploadedAsset(sql, {
          sessionId: importSessionId,
          storageKey: `import/${importSessionId}/${name}.jpg`,
          filename: `${name}.jpg`,
          mimeType: "image/jpeg",
          byteSize: 1024,
        });
      }
    });

    const assets = await withRls(admin, (sql) => listAssets(sql, importSessionId));
    expect(assets).toHaveLength(3);
    expect(assets.map((a) => a.sortOrder)).toEqual([0, 1, 2]);
    expect(assets.map((a) => a.originalFilename)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    // 서버가 직접 받은 파일이므로 업로드 확정 단계 없이 바로 분석 대상이 된다.
    expect(assets.every((a) => a.uploadedAt != null)).toBe(true);
    await closeActive();
  });

  it("같은 앨범이 동시에 들어와도 순서가 겹치지 않는다", async () => {
    await closeActive();
    const { importSessionId } = await newConversation();

    // 앨범은 여러 webhook 으로 나뉘어 거의 동시에 도착한다.
    await Promise.all(
      ["p1", "p2", "p3", "p4"].map((name) =>
        withRls(admin, (sql) =>
          appendUploadedAsset(sql, {
            sessionId: importSessionId,
            storageKey: `import/${importSessionId}/${name}.jpg`,
            filename: `${name}.jpg`,
            mimeType: "image/jpeg",
            byteSize: 2048,
          }),
        ),
      ),
    );

    const assets = await withRls(admin, (sql) => listAssets(sql, importSessionId));
    expect(assets.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3]);
    await closeActive();
  });

  it("대화를 ImportSession 으로 되찾을 수 있다", async () => {
    await closeActive();
    const { importSessionId } = await newConversation();
    const found = await withRls(admin, (sql) =>
      findConversationByImportSession(sql, importSessionId),
    );
    expect(found).toMatchObject({ importSessionId, state: "WAITING_MEDIA" });
    await closeActive();
  });

  it("방치된 대화는 만료된다", async () => {
    await closeActive();
    const { importSessionId } = await newConversation();
    await withOwner((sql) =>
      sql.query(
        `UPDATE telegram_import_sessions SET last_activity_at = now() - interval '48 hours'
          WHERE import_session_id = $1`,
        [importSessionId],
      ),
    );
    const expired = await withRls(admin, (sql) => expireStaleConversations(sql));
    expect(expired).toBeGreaterThanOrEqual(1);
    expect(await withRls(admin, (sql) => findActiveConversation(sql, TG_ADMIN))).toBeNull();
  });

  it("연결을 끊으면 진행 중이던 대화도 닫힌다", async () => {
    await closeActive();
    await newConversation();
    expect(await withRls(admin, (sql) => findConnectionForUser(sql, adminId))).not.toBeNull();

    const removed = await withRls(admin, (sql) => deleteConnectionForUser(sql, adminId));
    expect(removed).toBe(true);
    // 끊었는데 대화가 살아 있으면 다음 연결이 남의 세션을 이어받는다.
    expect(await withRls(admin, (sql) => findActiveConversation(sql, TG_ADMIN))).toBeNull();
    expect(await findTelegramIdentity(TG_ADMIN)).toBeNull();
  });
});

describe("권한 경계", () => {
  it("회원은 봇 대화를 읽지 못한다", async () => {
    const rows = await withRls(member, async (sql) => {
      const r = await sql.query(`SELECT id FROM telegram_import_sessions`);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(0);
  });

  it("회원은 봇 대화를 만들지 못한다", async () => {
    await expect(
      withRls(member, async (sql) => {
        const session = await sql.query<{ id: string }>(
          `SELECT id FROM import_sessions LIMIT 1`,
        );
        // 회원은 import_sessions 도 못 읽으므로 임의의 uuid 로 시도한다.
        const target = session.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
        return sql.query(
          `INSERT INTO telegram_import_sessions
             (import_session_id, telegram_user_id, telegram_chat_id)
           VALUES ($1, $2, $3)`,
          [target, TG_STRANGER, TG_STRANGER],
        );
      }),
    ).rejects.toThrow();
  });

  it("회원은 계정 연결 정보를 읽지 못한다", async () => {
    const rows = await withRls(member, async (sql) => {
      const r = await sql.query(`SELECT id FROM telegram_connections`);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(0);
  });

  it("런타임 롤은 연결 코드 테이블에 접근할 수 없다", async () => {
    // 정책이 없는 게 아니라 권한 자체가 없다(sessions/login_codes 와 같은 취급).
    await expect(
      withRls(admin, (sql) => sql.query(`SELECT 1 FROM telegram_link_codes`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("런타임 롤은 webhook 이벤트 테이블에 접근할 수 없다", async () => {
    await expect(
      withRls(admin, (sql) => sql.query(`SELECT 1 FROM telegram_webhook_events`)),
    ).rejects.toThrow(/permission denied/i);
  });
});
