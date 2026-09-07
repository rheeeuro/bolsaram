/**
 * 결정적 mock 추출기. 기본 프로바이더다.
 *
 * 실제 모델 대신 한국어 프로필 글에서 흔한 표기를 규칙으로 뽑는다. 목적은
 * 두 가지다 — (1) API 키 없이 전체 플로우를 돌려보기 (2) 테스트에서 재현 가능한 입력.
 * 규칙이 못 찾은 값은 추론하지 않고 null 로 둔다. 실제 모델과 같은 계약이다.
 */
import "server-only";
import {
  emptyExtractedFields,
  extractionResultSchema,
  JOB_CATEGORIES,
  MBTI_TYPES,
  REGIONS,
  type ExtractedFields,
  type ExtractionConfidence,
  type JobCategory,
  type Region,
} from "@bolsaram/schemas";
import {
  PROMPT_VERSION,
  type ExtractionInput,
  type ExtractionOutput,
  type ExtractionProvider,
} from "./types";

const REGION_KEYWORDS: Record<Region, string[]> = {
  SEOUL: ["서울", "강남", "송파", "마포", "성동", "용산"],
  GYEONGGI: ["경기", "성남", "분당", "수원", "고양", "일산", "용인", "판교"],
  INCHEON: ["인천", "송도"],
  BUSAN: ["부산", "해운대"],
  DAEGU: ["대구"],
  DAEJEON: ["대전"],
  GWANGJU: ["광주"],
  ULSAN: ["울산"],
  SEJONG: ["세종"],
  GANGWON: ["강원", "춘천", "원주", "강릉"],
  CHUNGBUK: ["충북", "청주"],
  CHUNGNAM: ["충남", "천안", "아산"],
  JEONBUK: ["전북", "전주"],
  JEONNAM: ["전남", "여수", "순천"],
  GYEONGBUK: ["경북", "포항", "구미"],
  GYEONGNAM: ["경남", "창원", "김해"],
  JEJU: ["제주"],
  OVERSEAS: ["해외", "미국", "일본", "싱가포르"],
};

const JOB_KEYWORDS: Record<JobCategory, string[]> = {
  IT: ["개발자", "엔지니어", "프로그래머", "IT", "백엔드", "프론트엔드", "데이터"],
  FINANCE: ["금융", "은행", "증권", "자산운용", "회계사", "애널리스트"],
  PROFESSIONAL: ["변호사", "회계사", "세무사", "변리사", "감정평가사"],
  PUBLIC: ["공무원", "공기업", "공사", "주무관"],
  MARKETING: ["마케터", "마케팅", "홍보", "PR", "브랜딩"],
  DESIGN: ["디자이너", "디자인", "UX", "UI"],
  MEDICAL: ["의사", "간호사", "약사", "치과", "한의사", "물리치료"],
  EDUCATION: ["교사", "강사", "교수", "교육"],
  SERVICE: ["서비스", "승무원", "호텔", "요식"],
  BUSINESS: ["사업", "대표", "창업", "경영"],
  ART: ["작가", "아티스트", "PD", "기자", "아나운서", "사진"],
  OTHER: [],
};

const SMOKING_RULES: [RegExp, ExtractedFields["smoking"]][] = [
  [/비\s*흡연|담배\s*안|금연/, "NONE"],
  [/가끔\s*(피|흡연)/, "OCCASIONAL"],
  [/흡연/, "REGULAR"],
];

const DRINKING_RULES: [RegExp, ExtractedFields["drinking"]][] = [
  [/술\s*안|음주\s*안|비\s*음주|금주/, "NONE"],
  [/가끔\s*(마|음주)/, "OCCASIONAL"],
  [/사회적\s*음주|적당히/, "SOCIAL"],
  [/즐(김|겨)|자주\s*마/, "REGULAR"],
];

const RELIGION_RULES: [RegExp, ExtractedFields["religion"]][] = [
  [/무교|종교\s*없/, "NONE"],
  [/개신교|기독교/, "CHRISTIAN"],
  [/천주교|카톨릭|가톨릭/, "CATHOLIC"],
  [/원불교/, "WON_BUDDHIST"],
  [/불교/, "BUDDHIST"],
];

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = "mock";

  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    const fields = emptyExtractedFields();
    const confidence: ExtractionConfidence = {};
    const notes: string[] = [];
    const text = input.text ?? "";

    if (text.trim().length === 0) {
      notes.push(
        input.images.length > 0
          ? "텍스트가 없어 이미지만으로는 항목을 채울 수 없습니다. 카카오톡에서 복사한 글을 붙여넣어 주세요."
          : "분석할 내용이 없습니다.",
      );
      return this.finish(fields, confidence, notes, input);
    }

    const set = <K extends keyof ExtractedFields>(
      key: K,
      value: ExtractedFields[K],
      score: number,
    ) => {
      if (value == null) return;
      fields[key] = value;
      confidence[key] = score;
    };

    set("gender", matchGender(text), 0.8);
    set("birthYear", matchBirthYear(text), 0.85);
    set("height", matchHeight(text), 0.9);
    set("mbti", matchMbti(text), 0.95);
    set("residenceRegion", matchRegion(text, ["거주", "지역", "살", "사는"]), 0.7);
    set("workplaceRegion", matchRegion(text, ["직장", "근무", "회사"]), 0.6);
    set("jobTitle", matchLabeled(text, ["직업", "하는 일", "직군"]), 0.7);
    set("company", matchLabeled(text, ["회사", "직장"]), 0.6);
    set("education", matchLabeled(text, ["학력", "학교", "대학"]), 0.65);
    set("jobCategory", matchJobCategory(text), 0.7);
    set("religion", matchRule(text, RELIGION_RULES), 0.8);
    set("smoking", matchRule(text, SMOKING_RULES), 0.8);
    set("drinking", matchRule(text, DRINKING_RULES), 0.75);
    set("hobbies", matchHobbies(text), 0.7);
    set("bio", matchLabeled(text, ["자기소개", "소개", "성격"]), 0.55);
    set("idealTypeText", matchLabeled(text, ["이상형", "원하는", "만나고 싶은"]), 0.6);

    if (fields.gender == null) notes.push("성별이 명시되어 있지 않습니다. 직접 선택해 주세요.");
    if (fields.birthYear == null) notes.push("나이/출생연도를 찾지 못했습니다.");
    if (input.images.length > 0 && text.length < 30) {
      notes.push("텍스트가 짧습니다. 이미지 속 내용은 사람이 확인해 주세요.");
    }

    return this.finish(fields, confidence, notes, input);
  }

  private finish(
    fields: ExtractedFields,
    confidence: ExtractionConfidence,
    notes: string[],
    input: ExtractionInput,
  ): ExtractionOutput {
    const raw = { fields, confidence, notes };
    // mock 도 실제 프로바이더와 같은 검증을 통과해야 한다.
    const parsed = extractionResultSchema.parse(raw);
    return {
      ...parsed,
      model: `mock/${input.images.length}img`,
      promptVersion: PROMPT_VERSION,
      raw,
    };
  }
}

// ── 규칙 ──────────────────────────────────────────────────────

function matchGender(text: string): ExtractedFields["gender"] {
  if (/(^|\s)(남자|남성|남)(\s|$|\/|,)/.test(text) || /성별\s*[:：]?\s*남/.test(text))
    return "MALE";
  if (/(^|\s)(여자|여성|여)(\s|$|\/|,)/.test(text) || /성별\s*[:：]?\s*여/.test(text))
    return "FEMALE";
  return null;
}

function matchBirthYear(text: string): ExtractedFields["birthYear"] {
  // `1993년생`, `93년생`, `87년`
  const full = /((?:19|20)\d{2})\s*년\s*생?/.exec(text);
  if (full?.[1]) return clampYear(Number(full[1]));
  const short = /(?:^|[^0-9])(\d{2})\s*년\s*생/.exec(text);
  if (short?.[1]) {
    const two = Number(short[1]);
    return clampYear(two >= 60 ? 1900 + two : 2000 + two);
  }
  // `32세`, `만 31살` — 기준 연도가 명확한 경우만.
  const age = /(?:만\s*)?(\d{2})\s*(?:세|살)/.exec(text);
  if (age?.[1]) return clampYear(new Date().getFullYear() - Number(age[1]));
  return null;
}

function clampYear(year: number): number | null {
  const max = new Date().getFullYear() - 18;
  return year >= 1960 && year <= max ? year : null;
}

function matchHeight(text: string): ExtractedFields["height"] {
  const m =
    /(1[3-9]\d|2[0-2]\d)\s*(?:cm|센치|센티)/i.exec(text) ??
    /키\s*[:：]?\s*(1[3-9]\d|2[0-2]\d)/.exec(text);
  if (!m?.[1]) return null;
  const value = Number(m[1]);
  return value >= 130 && value <= 220 ? value : null;
}

function matchMbti(text: string): ExtractedFields["mbti"] {
  const m = /\b([EI][NS][FT][JP])\b/i.exec(text);
  if (!m?.[1]) return null;
  const upper = m[1].toUpperCase();
  return (MBTI_TYPES as readonly string[]).includes(upper)
    ? (upper as ExtractedFields["mbti"])
    : null;
}

function matchRegion(text: string, hints: string[]): ExtractedFields["residenceRegion"] {
  // 힌트 라벨 뒤쪽을 먼저 훑고, 없으면 전체에서 찾는다.
  const scoped = sliceAfterAny(text, hints) ?? text;
  for (const region of REGIONS) {
    for (const keyword of REGION_KEYWORDS[region]) {
      if (scoped.includes(keyword)) return region;
    }
  }
  return null;
}

function matchJobCategory(text: string): ExtractedFields["jobCategory"] {
  for (const category of JOB_CATEGORIES) {
    for (const keyword of JOB_KEYWORDS[category]) {
      if (text.includes(keyword)) return category;
    }
  }
  return null;
}

function matchRule<T>(text: string, rules: [RegExp, T][]): T | null {
  for (const [pattern, value] of rules) {
    if (pattern.test(text)) return value;
  }
  return null;
}

function matchHobbies(text: string): ExtractedFields["hobbies"] {
  const scoped = sliceAfterAny(text, ["취미", "관심사", "좋아하는"]);
  if (!scoped) return null;
  const line = scoped.split("\n")[0] ?? "";
  const items = line
    .split(/[,·、/]|\s{2,}/)
    .map((s) => s.trim().replace(/^[:：\-\s]+/, ""))
    .filter((s) => s.length > 0 && s.length <= 40)
    .slice(0, 12);
  return items.length > 0 ? items : null;
}

/** `라벨: 값` 형태에서 값 부분만 한 줄 가져온다. */
function matchLabeled(text: string, labels: string[]): string | null {
  const scoped = sliceAfterAny(text, labels);
  if (!scoped) return null;
  const line =
    scoped
      .split("\n")[0]
      ?.replace(/^[:：\-\s]+/, "")
      .trim() ?? "";
  return line.length > 0 ? line.slice(0, 500) : null;
}

function sliceAfterAny(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index >= 0) return text.slice(index + label.length);
  }
  return null;
}
