/**
 * 텔레그램 계정 연결 (설계 변경 문서 TELEGRAM v1 §14).
 *
 * 봇은 검색으로 누구나 찾을 수 있으므로 **연결된 주선자만** Import 를 할 수 있다.
 * 이 파일이 그 "누구인가" 판정을 담당하는 인증 레이어다.
 *
 *   관리자 화면에서 코드 발급 → t.me/<봇>?start=<코드> → 봇이 /start <코드> 수신
 *   → 여기서 코드를 소비하고 텔레그램 계정을 ADMIN 계정에 연결
 *
 * owner 커넥션을 쓰는 이유: webhook 에는 세션 쿠키가 없다. 신원이 확정되기 전이라
 * RLS 컨텍스트를 만들 수 없으므로, 세션·OTP·초대 검증과 같은 취급을 한다.
 * **신원이 확정된 뒤의 모든 작업은 연결된 주선자 명의로 withRls 를 통과한다.**
 *
 * 코드는 평문으로 저장하지 않는다. invites 와 같은 방식으로 pepper 를 섞은 해시만
 * 남기고, 소비는 조건부 UPDATE 로 한 번만 성공하게 만든다(replay 차단).
 */
import "server-only";
import { withOwner, withOwnerTx, type RlsContext } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { env } from "../env";
import { peppered, randomToken } from "../crypto";

/** 연결 코드 유효시간. 짧게 둔다 — 발급 즉시 쓰는 흐름이다. */
export const TELEGRAM_LINK_CODE_TTL_MINUTES = 15;

/**
 * 초대 토큰과 같은 pepper 를 쓰되 용도를 접두어로 분리한다.
 * 한쪽에서 새어 나온 해시를 다른 쪽에 쓸 수 없게 만든다.
 */
function hashCode(code: string): string {
  return peppered(env().INVITE_TOKEN_PEPPER, `telegram-link:${code}`);
}

export type IssuedTelegramLinkCode = {
  /** 평문 코드. 이 순간 이후 다시 조회할 수 없다. 로그에 남기지 않는다. */
  code: string;
  expiresAt: Date;
  /** 운영자가 그대로 누르면 되는 딥링크. 봇 이름을 모르면 null. */
  deepLink: string | null;
};

/**
 * 주선자에게 연결 코드를 발급한다.
 * 주선자당 살아 있는 코드는 하나다 — 새로 발급하면 이전 것을 버린다.
 */
export async function issueTelegramLinkCode(
  userId: string,
  botUsername?: string,
): Promise<IssuedTelegramLinkCode> {
  const code = randomToken(16);
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MINUTES * 60_000);

  await withOwnerTx(async (sql) => {
    // 아직 쓰지 않은 코드는 지운다. 부분 유니크 인덱스(one_open)를 비워야 한다.
    await sql.query(`DELETE FROM telegram_link_codes WHERE user_id = $1 AND consumed_at IS NULL`, [
      userId,
    ]);
    await sql.query(
      `INSERT INTO telegram_link_codes (code_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [hashCode(code), userId, expiresAt],
    );
  });

  return {
    code,
    expiresAt,
    deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
  };
}

export type TelegramIdentity = {
  userId: string;
  role: "ADMIN" | "MEMBER";
  telegramUserId: number;
  telegramChatId: number;
};

/**
 * 코드를 소비하고 텔레그램 계정을 주선자 계정에 연결한다.
 *
 * `consumed_at IS NULL` 을 UPDATE 조건에 넣어 같은 코드를 두 번 쓸 수 없게 한다.
 * 같은 텔레그램 계정이 다시 연결하면 chat_id 만 갱신한다(재시도 안전).
 */
export async function consumeTelegramLinkCode(input: {
  code: string;
  telegramUserId: number;
  telegramChatId: number;
}): Promise<TelegramIdentity> {
  return withOwnerTx(async (sql) => {
    const claimed = await sql.query<{ user_id: string; role: "ADMIN" | "MEMBER" }>(
      `UPDATE telegram_link_codes c
          SET consumed_at = now(), consumed_by = $2
        WHERE c.code_hash = $1
          AND c.consumed_at IS NULL
          AND c.expires_at > now()
        RETURNING c.user_id,
                  (SELECT u.role FROM users u WHERE u.id = c.user_id) AS role`,
      [hashCode(input.code), input.telegramUserId],
    );
    const row = claimed.rows[0];
    if (!row) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 연결 코드입니다.");
    }
    // 주선자 전용 채널이다. 회원 계정으로는 연결하지 않는다(§15).
    if (row.role !== "ADMIN") {
      throw new DomainError("FORBIDDEN", "주선자 계정만 봇을 연결할 수 있습니다.");
    }

    // 텔레그램 계정 하나 ↔ 주선자 하나. 어느 쪽으로 충돌해도 이유를 알려준다.
    const other = await sql.query<{ user_id: string }>(
      `SELECT user_id FROM telegram_connections WHERE telegram_user_id = $1`,
      [input.telegramUserId],
    );
    const existing = other.rows[0];
    if (existing && existing.user_id !== row.user_id) {
      throw new DomainError("CONFLICT", "이 텔레그램 계정은 다른 주선자에게 연결되어 있습니다.");
    }

    await sql.query(
      `INSERT INTO telegram_connections (user_id, telegram_user_id, telegram_chat_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET telegram_user_id = EXCLUDED.telegram_user_id,
             telegram_chat_id = EXCLUDED.telegram_chat_id,
             linked_at = now()`,
      [row.user_id, input.telegramUserId, input.telegramChatId],
    );

    return {
      userId: row.user_id,
      role: row.role,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
    };
  });
}

/**
 * 이 텔레그램 사용자가 누구인지 알아낸다. 연결되지 않았으면 null.
 * webhook 이 가장 먼저 부르는 함수이며, 여기서 null 이면 아무것도 하지 않는다.
 */
export async function findTelegramIdentity(
  telegramUserId: number,
): Promise<TelegramIdentity | null> {
  return withOwner(async (sql) => {
    const result = await sql.query<{
      user_id: string;
      role: "ADMIN" | "MEMBER";
      telegram_chat_id: string | number;
    }>(
      `SELECT c.user_id, u.role, c.telegram_chat_id
         FROM telegram_connections c
         JOIN users u ON u.id = c.user_id
        WHERE c.telegram_user_id = $1`,
      [telegramUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    // 연결 후에 계정 권한이 내려갔을 수도 있다. 매 요청에 다시 확인한다.
    if (row.role !== "ADMIN") return null;
    return {
      userId: row.user_id,
      role: row.role,
      telegramUserId,
      telegramChatId: Number(row.telegram_chat_id),
    };
  });
}

/** 마지막 사용 시각. 관리자 화면에서 연결이 살아 있는지 보는 데 쓴다. */
export async function touchTelegramConnection(telegramUserId: number): Promise<void> {
  await withOwner((sql) =>
    sql.query(`UPDATE telegram_connections SET last_seen_at = now() WHERE telegram_user_id = $1`, [
      telegramUserId,
    ]),
  );
}

/** 신원을 RLS 컨텍스트로 바꾼다. 이후 모든 DB 접근은 이 컨텍스트를 통과한다. */
export function rlsContextOfTelegram(identity: TelegramIdentity): RlsContext {
  return { userId: identity.userId, role: identity.role };
}

// ── webhook 재전송 차단 ───────────────────────────────────────
// 채널 진입 통제의 일부이므로 초대 토큰 replay 차단과 같은 자리에 둔다.
// 신원이 확정되기 전에 판정해야 해서 여기서도 owner 커넥션을 쓴다.

/**
 * 이 update 를 처음 받았는지 확인하고 처리 대상으로 선점한다.
 *
 * `update_id` 는 봇 단위로 유일하다(Bot API «Update»). 텔레그램은 응답이 늦거나
 * 실패하면 같은 update 를 다시 보내므로, 여기서 걸러야 사진이 두 번 저장되지 않는다.
 * INSERT 충돌로 판정하므로 동시에 들어온 두 요청 중 하나만 통과한다.
 *
 * @returns 처음 받은 update 면 true, 재전송이면 false
 */
export async function claimTelegramUpdate(
  updateId: number,
  eventType: string,
): Promise<boolean> {
  return withOwner(async (sql) => {
    const result = await sql.query(
      `INSERT INTO telegram_webhook_events (update_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (update_id) DO NOTHING`,
      [updateId, eventType],
    );
    return (result.rowCount ?? 0) > 0;
  });
}

/** 처리를 끝냈다고 기록한다. 미처리로 남은 행은 실패 조사에 쓴다. */
export async function markTelegramUpdateProcessed(updateId: number): Promise<void> {
  await withOwner((sql) =>
    sql.query(`UPDATE telegram_webhook_events SET processed_at = now() WHERE update_id = $1`, [
      updateId,
    ]),
  );
}
