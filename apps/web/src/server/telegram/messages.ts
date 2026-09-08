/**
 * 봇 응답 문구 (설계 변경 문서 TELEGRAM v1 §12).
 *
 * 운영자 도구답게 짧고 직접적으로 쓴다. 다음 행동을 항상 한 줄로 알려준다.
 * **프로필 원문·사진·전화번호를 문구에 싣지 않는다** — 분석 결과 요약은
 * 예외적으로 몇 줄만 보여주고, 자세한 내용은 관리자 화면 링크로 넘긴다.
 */
import "server-only";
import { TELEGRAM_MAX_ASSETS_PER_SESSION, type ExtractedFields } from "@bolsaram/schemas";

export const messages = {
  notLinked: [
    "연결되지 않은 계정입니다.",
    "",
    "볼사람 관리자 화면 → Import Inbox → 「텔레그램 연결」에서",
    "연결 코드를 받아 /start <코드> 로 보내주세요.",
  ].join("\n"),

  startWithoutCode: [
    "볼사람 Import 봇입니다.",
    "",
    "관리자 화면 → Import Inbox → 「텔레그램 연결」에서 코드를 받아",
    "/start <코드> 로 보내주세요.",
  ].join("\n"),

  linked: [
    "연결됐습니다.",
    "",
    "프로필 사진을 보내고, 이어서 프로필 글을 보내주세요.",
    "글을 받으면 바로 분석합니다.",
    "",
    "/status 진행 상황 · /new 새로 시작 · /cancel 취소",
  ].join("\n"),

  alreadyLinked: "이미 연결된 계정입니다. 바로 사진을 보내주세요.",

  noGroup: [
    "아직 모임에 속해 있지 않습니다.",
    "",
    "볼사람 관리자 화면에서 모임을 만들거나,",
    "동료 주선자에게 초대를 받아 주세요.",
  ].join("\n"),

  help: [
    "프로필 사진을 보내고, 이어서 프로필 글을 보내주세요.",
    "",
    "/new 새 프로필 등록 시작",
    "/status 지금까지 받은 것",
    "/analyze 사진 설명만으로 분석",
    "/cancel 현재 등록 취소",
  ].join("\n"),

  newStarted: "새 프로필 등록을 시작합니다.\n사진을 보내주세요.",

  newReplacedPrevious: [
    "진행 중이던 등록을 취소하고 새로 시작합니다.",
    "사진을 보내주세요.",
  ].join("\n"),

  canceled: "현재 등록을 취소했습니다.",
  nothingToCancel: "진행 중인 등록이 없습니다.",

  /**
   * 첫 사진을 받은 뒤 한 번만 보낸다.
   * 장수를 말하지 않는 이유 — 카카오톡 「공유하기」로 보내면 사진이 하나씩 따로 도착해서
   * 이 시점의 장수는 최종 장수가 아니다. 총 장수는 글을 받을 때 알려준다.
   */
  mediaReceiving: "사진을 받고 있습니다.\n다 보내신 뒤 프로필 글을 보내주세요.",

  mediaFull: `사진은 한 세션에 ${TELEGRAM_MAX_ASSETS_PER_SESSION}장까지 받습니다. 프로필 글을 보내주세요.`,

  captionStored: [
    "사진 설명을 프로필 글로 받아뒀습니다.",
    "글을 따로 보내면 이어서 덧붙고, 설명만으로 분석하려면 /analyze 를 보내주세요.",
  ].join("\n"),

  /** 글을 받은 뒤. 여기서 사진 총 장수를 확정해 알려준다. */
  textReceived: (assetCount: number) =>
    (assetCount > 0
      ? `사진 ${assetCount}장과 프로필 내용을 받았습니다.`
      : "프로필 내용을 받았습니다.") + "\n분석을 시작합니다.",
  textTruncated: (assetCount: number) =>
    (assetCount > 0
      ? `사진 ${assetCount}장을 받았고, 프로필 내용이 너무 길어 일부만 저장했습니다.`
      : "프로필 내용이 너무 길어 일부만 저장했습니다.") + "\n분석을 시작합니다.",

  nothingToAnalyze: "분석할 내용이 없습니다. 사진이나 프로필 글을 보내주세요.",
  analyzing: "분석을 시작합니다.",

  status: (input: { assetCount: number; hasText: boolean; state: string }) =>
    [
      `사진 ${input.assetCount}장`,
      `프로필 글 ${input.hasText ? "있음" : "없음"}`,
      `상태 ${input.state}`,
    ].join(" · "),

  /**
   * 분석 완료 안내. 요약은 관리자가 이미 아는 항목만 몇 줄로 보여준다.
   * 자기소개·이상형 같은 긴 원문은 넣지 않는다.
   */
  analyzed: (fields: ExtractedFields, needsReview: boolean) => {
    const lines: string[] = ["분석이 완료됐습니다.", ""];
    const first = [
      fields.birthYear ? `${fields.birthYear}년생` : null,
      fields.height ? `${fields.height}cm` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (first) lines.push(first);
    if (fields.jobTitle) lines.push(fields.jobTitle);
    if (fields.company) lines.push(fields.company);
    if (fields.education) lines.push(fields.education);
    lines.push("");
    lines.push(
      needsReview
        ? "확인이 필요한 항목이 있습니다. 관리자 화면에서 검토해 주세요."
        : "관리자 화면에서 확인하고 등록해 주세요.",
    );
    return lines.join("\n");
  },

  analyzeFailed: "분석에 실패했습니다. 관리자 화면에서 다시 시도해 주세요.",

  unsupported: "사진이나 프로필 글만 처리합니다.",
  tooLarge: "사진이 너무 커서 받지 못했습니다. 관리자 화면에서 직접 올려주세요.",
  failed: "처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",

  reviewButton: "관리자 화면에서 검토",

  /**
   * 신청 알림 (마이그레이션 0017 의 아웃박스가 보낸다).
   * **사람을 공개 번호로만 가리킨다** — 이름·나이·연락처를 봇 메시지에 싣지 않는다.
   * 누가 누구인지는 관리자 화면에서 본다.
   */
  matchRequested: (requesterCode: number | null, targetCode: number | null) =>
    ["새 신청이 들어왔습니다.", "", pairLine(requesterCode, targetCode, "→")].join("\n"),

  /** 수락은 곧 연결이다. 주선자가 할 일은 없지만 실제 소개는 사람이 하므로 알린다. */
  matchAccepted: (requesterCode: number | null, targetCode: number | null) =>
    [
      "신청이 수락돼 두 분이 연결됐습니다.",
      "",
      pairLine(requesterCode, targetCode, "↔"),
    ].join("\n"),

  requestsButton: "신청 목록 열기",
} as const;

/** 공개 번호가 없으면(프로필이 지워진 뒤) 번호 자리를 비워 둔다. */
function pairLine(a: number | null, b: number | null, arrow: string): string {
  const code = (value: number | null) => (value === null ? "?" : `${value}번`);
  return `${code(a)} ${arrow} ${code(b)}`;
}
