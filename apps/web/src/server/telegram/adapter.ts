/**
 * TelegramImportAdapter (설계 변경 문서 TELEGRAM v1 §8·§9·§10).
 *
 *   Telegram Update → 신원 확인 → 의도 판정 → ImportSession 갱신 → 봇 응답
 *
 * 이 파일이 Bot API 와 Import 도메인 사이의 유일한 경계다. Import 서비스는
 * 텔레그램을 모르고, 이 파일은 프로필 필드 의미를 모른다.
 *
 * 지키는 것:
 *   * webhook 안에서 AI 분석을 기다리지 않는다. 상태만 갱신하고 분석은 따로 띄운다(§10).
 *   * 네트워크 호출(파일 다운로드)은 RLS 트랜잭션 **밖에서** 한다 — 트랜잭션을
 *     외부 응답 시간만큼 붙잡고 있으면 커넥션 풀이 마른다.
 *   * 신원 확인만 owner 커넥션이고, 그 뒤 모든 DB 접근은 연결된 주선자 명의의
 *     withRls 를 통과한다. webhook 은 RLS 를 우회하지 않는다.
 *   * 로그에 프로필 원문·사진·텔레그램 식별값을 남기지 않는다(§15).
 */
import "server-only";
import { withRls, type RlsContext, type Sql } from "@bolsaram/db";
import {
  DomainError,
  assertAssetCapacity,
  classifyTelegramMessage,
  mergeRawText,
  nextTelegramState,
  shouldAnnounceMedia,
  type TelegramIntent,
} from "@bolsaram/domain";
import {
  TELEGRAM_SESSION_STATE_LABELS,
  telegramUpdateSchema,
  type TelegramMessage,
} from "@bolsaram/schemas";
import { writeAudit } from "../audit";
import {
  claimTelegramUpdate,
  consumeTelegramLinkCode,
  findTelegramIdentity,
  markTelegramUpdateProcessed,
  rlsContextOfTelegram,
  touchTelegramConnection,
  type TelegramIdentity,
} from "../auth/telegram";
import { env } from "../env";
import * as imports from "../repo/imports";
import * as conversations from "../repo/telegram";
import { analyzeSession } from "../services/import-service";
import { buildStorageKey, putObject } from "../storage/local";
import { downloadFile, getFile, sendMessage } from "./client";
import { messages } from "./messages";

/**
 * webhook 진입점. 어떤 경우에도 예외를 밖으로 던지지 않는다 —
 * 텔레그램에 200 이 아닌 응답을 주면 같은 update 를 계속 재전송한다.
 * 대신 실패를 서버 로그와 봇 메시지로 남긴다.
 */
export async function handleTelegramUpdate(raw: unknown): Promise<void> {
  const parsed = telegramUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("텔레그램 update 형식이 올바르지 않습니다.");
    return;
  }
  const update = parsed.data;
  const message = update.message ?? update.edited_message;

  // 재전송이면 아무것도 하지 않는다. 사진이 두 번 저장되는 것을 막는 지점이다.
  const isFirstTime = await claimTelegramUpdate(
    update.update_id,
    message ? "message" : "other",
  );
  if (!isFirstTime) return;

  try {
    if (message) await route(message);
    await markTelegramUpdateProcessed(update.update_id);
  } catch (error) {
    // 어디서 실패했는지는 남기고 내용은 남기지 않는다.
    console.error(
      "텔레그램 update 처리 실패",
      error instanceof DomainError ? { code: error.code, message: error.message } : error,
    );
    if (message) {
      await sendMessage(
        message.chat.id,
        error instanceof DomainError ? error.message : messages.failed,
      ).catch(() => {
        // 답장까지 실패하면 더 할 수 있는 게 없다. 위 로그로 충분하다.
      });
    }
  }
}

async function route(message: TelegramMessage): Promise<void> {
  const sender = message.from;
  // 발신자를 모르면 누구 명의로 저장할지 정할 수 없다.
  if (!sender || sender.is_bot) return;

  const intent = classifyTelegramMessage(message);

  // 무엇으로 해석했는지만 남긴다. 프로필 원문·사진·텔레그램 식별값은 남기지 않는다(§15).
  // 봇이 조용히 아무 일도 하지 않을 때 원인을 알 수 있는 유일한 단서다.
  console.info(
    `텔레그램 수신: ${intent.kind}` +
      (intent.kind === "command" ? ` ${intent.command}` : "") +
      (intent.kind === "ignored" ? ` (${intent.reason})` : "") +
      (intent.kind === "photo" ? ` ${intent.mediaGroupId ? "앨범" : "단독"}` : ""),
  );

  // /start 는 연결 전에도 동작해야 하는 유일한 명령이다.
  if (intent.kind === "command" && intent.command === "/start") {
    await handleStart(message.chat.id, sender.id, intent.argument);
    return;
  }

  const identity = await findTelegramIdentity(sender.id);
  if (!identity) {
    await sendMessage(message.chat.id, messages.notLinked);
    return;
  }
  await touchTelegramConnection(sender.id);

  const ctx = rlsContextOfTelegram(identity);
  switch (intent.kind) {
    case "command":
      await handleCommand(ctx, identity, intent);
      return;
    case "photo":
      await handlePhoto(ctx, identity, intent);
      return;
    case "text":
      await handleText(ctx, identity, intent.text);
      return;
    case "ignored":
      await sendMessage(identity.telegramChatId, messages.unsupported);
      return;
  }
}

// ── 계정 연결 ─────────────────────────────────────────────────

async function handleStart(
  chatId: number,
  telegramUserId: number,
  code: string | null,
): Promise<void> {
  if (!code) {
    const existing = await findTelegramIdentity(telegramUserId);
    await sendMessage(chatId, existing ? messages.alreadyLinked : messages.startWithoutCode);
    return;
  }

  const identity = await consumeTelegramLinkCode({
    code,
    telegramUserId,
    telegramChatId: chatId,
  });
  // 연결은 감사 대상이다. 텔레그램 식별값은 남기지 않는다.
  await withRls(rlsContextOfTelegram(identity), (sql) =>
    writeAudit(sql, {
      actorUserId: identity.userId,
      action: "telegram.link",
      entityType: "user",
      entityId: identity.userId,
    }),
  );
  await sendMessage(chatId, messages.linked);
}

// ── 명령 ──────────────────────────────────────────────────────

async function handleCommand(
  ctx: RlsContext,
  identity: TelegramIdentity,
  intent: Extract<TelegramIntent, { kind: "command" }>,
): Promise<void> {
  switch (intent.command) {
    case "/new": {
      const replaced = await withRls(ctx, async (sql) => {
        const active = await conversations.findActiveConversation(sql, identity.telegramUserId);
        if (active) {
          await conversations.updateConversation(sql, active, { state: "CANCELED" });
        }
        await startConversation(sql, ctx, identity);
        return active != null;
      });
      await sendMessage(
        identity.telegramChatId,
        replaced ? messages.newReplacedPrevious : messages.newStarted,
      );
      return;
    }

    case "/cancel": {
      const canceled = await withRls(ctx, async (sql) => {
        const active = await conversations.findActiveConversation(sql, identity.telegramUserId);
        if (!active) return false;
        await conversations.updateConversation(sql, active, { state: "CANCELED" });
        return true;
      });
      await sendMessage(
        identity.telegramChatId,
        canceled ? messages.canceled : messages.nothingToCancel,
      );
      return;
    }

    case "/status": {
      const status = await withRls(ctx, async (sql) => {
        const active = await conversations.findActiveConversation(sql, identity.telegramUserId);
        if (!active) return null;
        const session = await imports.requireSession(sql, active.importSessionId);
        const assets = await imports.listAssets(sql, active.importSessionId);
        return {
          assetCount: assets.filter((a) => a.uploadedAt != null).length,
          hasText: (session.rawText?.trim().length ?? 0) > 0,
          state: TELEGRAM_SESSION_STATE_LABELS[active.state],
        };
      });
      await sendMessage(
        identity.telegramChatId,
        status ? messages.status(status) : messages.nothingToCancel,
      );
      return;
    }

    case "/analyze": {
      const sessionId = await withRls(ctx, async (sql) => {
        const active = await conversations.findActiveConversation(sql, identity.telegramUserId);
        if (!active) return null;
        const session = await imports.requireSession(sql, active.importSessionId);
        // 사진은 모델에 보내지 않으므로 원문이 없으면 분석할 것이 없다.
        const hasText = (session.rawText?.trim().length ?? 0) > 0;
        return hasText ? active.importSessionId : null;
      });
      if (!sessionId) {
        await sendMessage(identity.telegramChatId, messages.nothingToAnalyze);
        return;
      }
      await sendMessage(identity.telegramChatId, messages.analyzing);
      triggerAnalyze(ctx, identity, sessionId);
      return;
    }

    case "/help":
      await sendMessage(identity.telegramChatId, messages.help);
      return;

    // /start 는 route 에서 이미 처리했다.
    case "/start":
      return;
  }
}

// ── 사진 ──────────────────────────────────────────────────────

async function handlePhoto(
  ctx: RlsContext,
  identity: TelegramIdentity,
  intent: Extract<TelegramIntent, { kind: "photo" }>,
): Promise<void> {
  // 1) 대화를 확보하고 여유가 있는지 본다. 여기서 트랜잭션을 닫는다.
  const prepared = await withRls(ctx, async (sql) => {
    const conversation = await ensureConversation(sql, ctx, identity);
    const assets = await imports.listAssets(sql, conversation.importSessionId);
    const uploaded = assets.filter((a) => a.uploadedAt != null);
    return { conversation, uploadedCount: uploaded.length };
  });

  try {
    assertAssetCapacity(prepared.uploadedCount);
  } catch {
    await sendMessage(identity.telegramChatId, messages.mediaFull);
    return;
  }

  // 2) 파일을 받아 private 스토리지로 복사한다. 트랜잭션 밖이다.
  //    텔레그램의 임시 URL 은 어디에도 저장하지 않는다(§15).
  const file = await getFile(intent.fileId);
  if (!file.file_path) {
    await sendMessage(identity.telegramChatId, messages.tooLarge);
    return;
  }
  const downloaded = await downloadFile(file.file_path, intent.mimeType);
  const storageKey = buildStorageKey(
    "import",
    prepared.conversation.importSessionId,
    downloaded.mimeType,
  );
  await putObject(storageKey, downloaded.data);

  // 3) 에셋을 붙이고 상태를 갱신한다.
  const result = await withRls(ctx, async (sql) => {
    const conversation = await conversations.findConversationByImportSession(
      sql,
      prepared.conversation.importSessionId,
    );
    if (!conversation) {
      throw new DomainError("NOT_FOUND", "대화를 찾을 수 없습니다.");
    }
    await imports.appendUploadedAsset(sql, {
      sessionId: conversation.importSessionId,
      storageKey,
      filename: intent.filename,
      mimeType: downloaded.mimeType,
      byteSize: downloaded.byteSize,
    });

    const session = await imports.requireSession(sql, conversation.importSessionId);
    // 사진 설명은 글이 아직 없을 때만 원문으로 쓴다(§5.4).
    let hasText = (session.rawText?.trim().length ?? 0) > 0;
    let captionStored = false;
    if (intent.caption) {
      const merged = mergeRawText(session.rawText, {
        source: "caption",
        value: intent.caption,
      });
      if (merged.changed) {
        await imports.updateRawText(sql, conversation.importSessionId, merged.rawText);
        hasText = true;
        captionStored = true;
      }
    }

    const assets = await imports.listAssets(sql, conversation.importSessionId);
    const uploadedCount = assets.filter((a) => a.uploadedAt != null).length;
    // caption 만으로 상태를 READY 로 올리지 않는다. 사진이 아직 들어오는 중일 수 있어
    // 자동 분석을 걸면 절반만 분석된다. 분석은 글을 받거나 /analyze 로만 시작한다.
    // 안내는 첫 장에만. 이번 사진을 넣기 전 장수로 판정한다.
    const announce = shouldAnnounceMedia(uploadedCount - 1);
    const nextState = nextTelegramState({
      current: conversation.state,
      assetCount: uploadedCount,
      hasText: false,
    });
    await conversations.updateConversation(sql, conversation, {
      state: nextState,
      lastMediaGroupId: intent.mediaGroupId,
    });

    return { uploadedCount, announce, captionStored, hasText };
  });

  // 봇이 무엇을 답했는지 남긴다. 안내가 장수만큼 나가는 회귀를 데이터로 잡을 수 있어야 한다
  // (문구·프로필 내용은 남기지 않는다).
  console.info(
    `텔레그램 응답: 사진 ${result.uploadedCount}장째 · 안내 ${result.announce ? "전송" : "생략"}`,
  );
  if (result.announce) {
    await sendMessage(identity.telegramChatId, messages.mediaReceiving);
    if (result.captionStored) {
      await sendMessage(identity.telegramChatId, messages.captionStored);
    }
  }
}

// ── 프로필 글 ─────────────────────────────────────────────────

async function handleText(
  ctx: RlsContext,
  identity: TelegramIdentity,
  text: string,
): Promise<void> {
  const result = await withRls(ctx, async (sql) => {
    const conversation = await ensureConversation(sql, ctx, identity);
    const session = await imports.requireSession(sql, conversation.importSessionId);
    // 직접 보낸 글은 누적한다. 카카오톡 프로필이 여러 메시지로 쪼개져 오는 일이 흔하다.
    const merged = mergeRawText(session.rawText, { source: "text", value: text });
    if (merged.changed) {
      await imports.updateRawText(sql, conversation.importSessionId, merged.rawText);
    }
    const assets = await imports.listAssets(sql, conversation.importSessionId);
    const uploadedCount = assets.filter((a) => a.uploadedAt != null).length;
    await conversations.updateConversation(sql, conversation, {
      state: nextTelegramState({
        current: conversation.state,
        assetCount: uploadedCount,
        hasText: merged.rawText.length > 0,
      }),
    });
    return {
      sessionId: conversation.importSessionId,
      truncated: merged.truncated,
      uploadedCount,
    };
  });

  await sendMessage(
    identity.telegramChatId,
    result.truncated
      ? messages.textTruncated(result.uploadedCount)
      : messages.textReceived(result.uploadedCount),
  );
  triggerAnalyze(ctx, identity, result.sessionId);
}

// ── 대화 확보 ─────────────────────────────────────────────────

/**
 * 진행 중인 대화가 있으면 쓰고, 없으면 새로 만든다.
 * `/new` 없이 바로 사진을 보내도 동작해야 한다(§4.1 의 예시가 그렇다).
 */
async function ensureConversation(
  sql: Sql,
  ctx: RlsContext,
  identity: TelegramIdentity,
): Promise<conversations.TelegramConversationRecord> {
  const active = await conversations.findActiveConversation(sql, identity.telegramUserId);
  if (active) return active;
  return startConversation(sql, ctx, identity);
}

async function startConversation(
  sql: Sql,
  ctx: RlsContext,
  identity: TelegramIdentity,
): Promise<conversations.TelegramConversationRecord> {
  // created_by 를 연결된 주선자로 남긴다 — 관리자 화면에서 누가 가져왔는지 보인다.
  // 모임이 없으면 group_id 는 null 이고 그 결과는 전체공개 프로필이 된다(웹 업로드와 같다).
  const session = await imports.createSession(sql, {
    groupId: identity.groupId,
    createdBy: identity.userId,
    source: "TELEGRAM",
  });
  const conversation = await conversations.createConversation(sql, {
    importSessionId: session.id,
    telegramUserId: identity.telegramUserId,
    telegramChatId: identity.telegramChatId,
  });
  await writeAudit(sql, {
    actorUserId: ctx.userId,
    action: "import.create",
    entityType: "import_session",
    entityId: session.id,
    metadata: { source: "TELEGRAM" },
  });
  return conversation;
}

// ── 분석 ──────────────────────────────────────────────────────

/**
 * 분석을 webhook 응답과 분리해 띄운다(§10 「webhook 안에서 오래 실행하지 않는다」).
 *
 * 이 프로세스는 PM2 로 상시 떠 있으므로 응답 후에도 계속 돈다. 실패는
 * analyzeSession 이 세션을 FAILED 로 남기고, 여기서 봇에게 알린다.
 * await 하지 않으므로 rejection 을 반드시 붙잡아야 한다.
 */
function triggerAnalyze(ctx: RlsContext, identity: TelegramIdentity, sessionId: string): void {
  void (async () => {
    try {
      const result = await analyzeSession(ctx, sessionId);
      const fields = await withRls(ctx, async (sql) => {
        const extraction = await imports.latestExtraction(sql, sessionId);
        return imports.effectiveFields(extraction);
      });
      await sendMessage(
        identity.telegramChatId,
        messages.analyzed(fields, result.status === "REVIEW_REQUIRED"),
        {
          buttonText: messages.reviewButton,
          buttonUrl: `${env().APP_ORIGIN}/imports/${sessionId}`,
        },
      );
    } catch (error) {
      console.error(
        "텔레그램 Import 분석 실패",
        error instanceof DomainError ? { code: error.code } : error,
      );
      await sendMessage(identity.telegramChatId, messages.analyzeFailed).catch(() => {
        // 알림 실패는 위 로그로 갈음한다.
      });
    }
  })();
}
