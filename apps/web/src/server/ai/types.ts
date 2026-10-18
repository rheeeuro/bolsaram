/**
 * AI 추출 프로바이더 인터페이스 (부트스트랩 §9).
 * 구현체를 갈아끼울 수 있어야 하고, 테스트에서는 mock 을 쓴다.
 */
import "server-only";
import {
  DRINKING_LABELS,
  DRINKING_LEVELS,
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  REGIONS,
  REGION_LABELS,
  RELIGIONS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  SMOKING_LEVELS,
  type ExtractionResult,
} from "@bolsaram/schemas";

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
export const PROMPT_VERSION = "2026-10-18.6";

/** 열거형 코드와 한글 이름. 이상형 조건에서 「수도권」「비흡연자」를 코드로 옮기게 한다. */
const codes = (values: readonly string[], labels: Record<string, string>) =>
  values.map((v) => `${v}=${labels[v]}`).join(", ");

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
  "",
  "거주 구·시·군(residenceDistrict):",
  "- 서울이면 구, 경기면 시·군을 고른다. 다른 광역이거나 원문에 구·시·군·동네가 없으면 null 이다.",
  "- 동네 이름은 속한 구·시로 옮긴다(잠실 → 송파구, 여의도 → 영등포구, 목동 → 양천구, 홍대 → 마포구,",
  "  분당·판교 → 성남시, 수지·기흥 → 용인시, 일산 → 고양시, 동탄 → 화성시, 광교 → 수원시, 평촌 → 안양시).",
  "- residenceRegion 과 같은 광역이어야 한다. 직장 위치는 넣지 않는다.",
  "",
  "해시태그(hashtags):",
  "- 이 사람을 한눈에 알아보게 하는 짧은 태그를 최대 10개 만든다.",
  "- 원문에 `#태그` 가 이미 있으면 그대로 쓴다.",
  "- 나머지는 원문에 **명시된 내용**(취미·관심사·라이프스타일·성격·직업)만 태그로 옮긴다.",
  "  원문에 없는 성향을 지어내지 않는다. 옮길 것이 없으면 빈 배열이다.",
  "- `#` 없이, 띄어쓰기 없이, 한 태그는 20자 이내의 명사구로 쓴다(예: 등산, 카페투어, 반려견).",
  "- 이름·회사·지역·나이처럼 다른 필드가 이미 가진 값은 태그로 만들지 않는다.",
  "",
  "이상형 조건(idealCriteria):",
  "- 원문의 이상형·원하는 이성상 부분을 조건으로 옮긴다. 이상형 글이 없으면 idealCriteria 는 null 이다.",
  "- 글에 **명시된** 조건만 옮긴다. 적히지 않은 조건은 null 이나 빈 배열로 둔다. 추론하지 않는다.",
  "- **먼저 피하는 것을 가려낸다.** 「비선호」「싫어요」「별로」「X」「~만 아니면」은 피한다는 뜻이고,",
  "  그 조건의 반대(받아들이는 값)로 옮긴다. **나열 끝에 붙으면 나열한 낱말 모두에 걸린다.**",
  "  · 「연상, 담배, 문신 비선호」 = 연상도 담배도 문신도 피한다 → birthYearMin = birthYear(동갑·연하), smoking [NONE].",
  "    문신처럼 열거형으로 옮길 수 없는 것은 avoidKeywords 에 넣는다(→ avoidKeywords [문신]). birthYearMax 를 채우면 정반대가 된다.",
  "  · 「담배x」「흡연자는 별로」 → smoking [NONE]. 「기독교만 아니면」 → 기독교를 뺀 나머지 종교.",
  "- 나이는 상대의 출생연도 범위(birthYearMin·birthYearMax)다. 상대적 표현은 이 사람의 birthYear 로 환산한다.",
  "  · 「연상」 → birthYearMax = birthYear - 1. 「연하」 → birthYearMin = birthYear + 1.",
  "  · 「동갑~3살 연상」 → birthYearMin = birthYear - 3, birthYearMax = birthYear.",
  "  · 「연상 비선호」「연상 X」처럼 **피하는 것**을 적었으면 반대쪽 범위로 옮긴다 → birthYearMin = birthYear.",
  "  · 「2살 연상까지」처럼 한쪽 끝만 말했으면 그 끝만 채운다 → birthYearMin = birthYear - 2 (연하를 막지 않는다).",
  "  · 「30대 초반」처럼 나이로 적었으면 올해 연도에서 빼서 환산한다(한국 나이 아님).",
  "  · 이 사람의 birthYear 를 모르면 상대적 나이는 비운다. 「나이 상관없음」도 비운다.",
  "- 키는 cm 정수로 heightMin·heightMax 에 둔다(「175 이상」 → heightMin 175).",
  `- 지역(regions): ${codes(REGIONS, REGION_LABELS)}. 「수도권」은 SEOUL·GYEONGGI·INCHEON. 「가까운 곳」처럼 지역이 없으면 비운다.`,
  `- 종교(religions): ${codes(RELIGIONS, RELIGION_LABELS)}. 받아들이는 값을 모두 적는다(「기독교만 아니면」 → 기독교를 뺀 나머지). 「같은 종교」는 이 사람의 religion 을 쓰고, 모르면 비운다.`,
  `- 흡연(smoking): ${codes(SMOKING_LEVELS, SMOKING_LABELS)}. 「비흡연자」 → [NONE].`,
  `- 음주(drinking): ${codes(DRINKING_LEVELS, DRINKING_LABELS)}. 받아들이는 값을 모두 적는다.`,
  `- 직업군(jobCategories): ${codes(JOB_CATEGORIES, JOB_CATEGORY_LABELS)}. 직업이 분명히 적혔을 때만. 「안정적인 직장」처럼 막연하면 비운다.`,
  "- keywords: 상대에게 **바라는** 성격·취미·생활만 짧은 명사로 최대 10개(예: 운동, 여행, 다정함, 자기관리, 반려견).",
  "  keywords 는 상대에게 있으면 더 잘 맞는다고 보는 값이다 — 피하는 것을 넣으면 거꾸로 그런 사람을 추천한다.",
  "- avoidKeywords: 피한다고 적었지만 위 열거형으로 옮길 수 없는 것만 짧은 명사로 최대 10개(예: 문신, 게임중독, 마마보이).",
  "  흡연·음주·종교·나이·지역처럼 열거형으로 옮긴 것은 넣지 않는다. 외모 평가는 넣지 않는다. `#` 없이, 띄어쓰기 없이.",
  "  `#` 없이, 띄어쓰기 없이 20자 이내. 외모 평가(예쁜·잘생긴)와 위 조건으로 이미 옮긴 값은 넣지 않는다.",
  "- required: 「꼭」「필수」「절대」「무조건」처럼 양보하지 않는다고 적은 조건만",
  "  (age·height·region·religion·smoking·drinking·job 중에서).",
  "- idealCriteria 의 confidence 는 이상형 글을 조건으로 얼마나 확실히 옮겼는지다.",
].join("\n");
