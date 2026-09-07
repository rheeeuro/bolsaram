/**
 * AI 추출 프로바이더 인터페이스 (부트스트랩 §9).
 * 구현체를 갈아끼울 수 있어야 하고, 테스트에서는 mock 을 쓴다.
 */
import "server-only";
import type { ExtractionResult } from "@bolsaram/schemas";

/**
 * 추출 입력은 **원문 텍스트뿐이다. 사진은 모델에 보내지 않는다.**
 *
 * 프로필은 항상 카카오톡에서 복사한 텍스트로 들어온다(운영 확인). 사진을 함께 보내면
 * 실제 인물 사진이 외부 모델로 나가는데 얻는 정보가 없다 — 프롬프트도 원문을 우선하고,
 * 실측(2026-09-07)에서도 채워진 11개 필드가 전부 원문에서 나왔다. 입력 토큰은
 * 장당 156~230 개씩 늘어난다.
 *
 * 그래서 이미지 필드를 아예 두지 않는다. 조건부로 두면 언젠가 조건이 뒤집힌다.
 * 사진에서 정보를 읽어야 하는 경우(스크린샷)가 실제로 생기면 그때 다시 넣는다.
 */
export type ExtractionInput = {
  /** 정규화된 원문. 유일한 source 다(설계문서 §11). */
  text: string | null;
};

export type ExtractionOutput = ExtractionResult & {
  model: string;
  promptVersion: string;
  /** 검증 전 모델 원문. 디버깅 용도로만 저장한다. */
  raw: unknown;
};

export interface ExtractionProvider {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

/** 프롬프트를 고칠 때마다 올린다. 추출 결과에 함께 저장해 재현 가능하게 한다. */
export const PROMPT_VERSION = "2026-09-07.1";

export const SYSTEM_PROMPT = [
  "너는 한국어 소개팅 프로필 텍스트에서 구조화된 정보를 뽑는 도구다.",
  "",
  "규칙:",
  "- 원문에 명시되지 않은 값은 추론하지 말고 반드시 null 로 둔다.",
  "- 이름/닉네임처럼 성별을 암시하는 단서만으로 gender 를 채우지 않는다.",
  "- 나이가 적혀 있으면 birthYear 로 환산하되, 기준 연도가 모호하면 null 로 둔다.",
  "- '87년생', '93' 같은 표기는 birthYear 로 정규화한다.",
  "- 키는 cm 정수로만 채운다.",
  "- 열거형 필드는 주어진 값 중 하나만 쓴다. 해당하는 값이 없으면 null 이다.",
  "- 각 필드의 confidence 를 0~1 로 매긴다. null 인 필드는 0 에 가깝게 둔다.",
  "- 애매하거나 사람이 확인해야 하는 부분은 notes 에 한국어 한 줄로 적는다.",
  "- 텍스트와 이미지가 충돌하면 텍스트를 우선한다.",
].join("\n");
