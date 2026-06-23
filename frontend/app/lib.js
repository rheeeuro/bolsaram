export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
export const CURRENT_YEAR = new Date().getFullYear();
export const statuses = ["등록됨", "소개 가능", "검토 중", "제안 완료", "수락", "연락처 교환", "만남 예정", "만남 완료", "거절", "보류", "매칭 완료"];
export const matchStatuses = ["추천됨", "제안 완료", "수락", "연락처 교환", "만남 예정", "완료", "거절"];
export const emptyCandidate = {
  rawText: "",
  alias: "",
  gender: "여",
  birthYear: "",
  height: "",
  location: "",
  job: "",
  education: "",
  religion: "미입력",
  smoke: "미입력",
  drink: "미입력",
  mbti: "",
  privacy: "그룹 내 공개",
  personality: "",
  hobbies: "",
  ideal: "",
  memo: "",
  contact: "",
  consent: false,
};

export const defaultFilters = {
  search: "",
  gender: "all",
  minAge: "",
  maxAge: "",
  minHeight: "",
  region: "",
  job: "all",
  religion: "all",
  nonSmoker: false,
  status: "all",
};

export async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || "요청을 처리하지 못했습니다.");
  return payload;
}

export function roomUrl(roomId) {
  return `/rooms/${roomId}`;
}

export function roomIdFromPath(pathname) {
  return pathname.match(/^\/rooms\/([^/]+)\/?$/)?.[1] || "";
}

export function updateBrowserUrl(path, replace = false) {
  if (typeof window === "undefined" || window.location.pathname === path) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
}

export function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s/g, "");
}

export function age(candidate) {
  return CURRENT_YEAR - Number(candidate.birthYear);
}

export function initials(candidate) {
  return candidate.alias?.replace(/\s/g, "").slice(-1) || "?";
}

export function primaryPhotoUrl(candidate) {
  const photo = candidate.photos?.find((item) => item.isPrimary) || candidate.photos?.[0];
  return photo ? `${API_URL}${photo.imageUrl}` : "";
}

export function splitWords(value) {
  return String(value || "").split(/[,\s/·]+/).map((word) => word.trim()).filter(Boolean);
}

export function jobGroup(job) {
  const text = normalize(job);
  if (/은행|금융|보험|증권/.test(text)) return "금융";
  if (/현대|삼성|lg|sk|자동차|대기업/.test(text)) return "대기업";
  if (/공무원|공공/.test(text)) return "공무원";
  if (/it|개발|기획|서비스|테크/.test(text)) return "IT";
  if (/변호사|의사|회계사|전문직|로펌/.test(text)) return "전문직";
  return "기타";
}

export function closeRegion(a, b) {
  const groups = [["강남", "삼성", "판교", "분당", "야탑"], ["김포", "마포", "공항", "서울"]];
  const one = normalize(a);
  const two = normalize(b);
  return groups.some((group) => group.some((word) => one.includes(word)) && group.some((word) => two.includes(word)));
}

export function matchScore(a, b) {
  let score = 0;
  const reasons = [];
  const ageDiff = Math.abs(age(a) - age(b));
  const sharedHobbies = splitWords(a.hobbies).filter((hobby) => splitWords(b.hobbies).includes(hobby));
  const sameReligion = a.religion === b.religion || a.religion === "미입력" || b.religion === "미입력";
  const smokeOk = a.smoke === b.smoke || a.smoke === "미입력" || b.smoke === "미입력";
  const idealHit = splitWords(a.ideal).some((word) => normalize(b.personality).includes(normalize(word)));

  if (ageDiff <= 4) {
    score += 20;
    reasons.push("나이 차이 적절");
  } else if (ageDiff <= 7) {
    score += 12;
    reasons.push("나이 조건 검토 가능");
  }
  if (closeRegion(a.location, b.location)) {
    score += 15;
    reasons.push("생활권 가까움");
  }
  if (sameReligion) {
    score += 15;
    reasons.push("종교 조건 충족");
  }
  if (smokeOk) {
    score += 15;
    reasons.push("흡연 조건 충족");
  }
  if (sharedHobbies.length) {
    score += Math.min(10, sharedHobbies.length * 5);
    reasons.push(`공통 취미 ${sharedHobbies.slice(0, 2).join(", ")}`);
  }
  if (a.mbti && b.mbti && a.mbti[0] !== b.mbti[0]) {
    score += 8;
    reasons.push("성향 밸런스");
  }
  if (idealHit) {
    score += 10;
    reasons.push("이상형 키워드 일부 일치");
  }
  if (["금융", "대기업", "전문직", "공무원"].includes(jobGroup(b.job))) {
    score += 5;
    reasons.push("직업 안정성");
  }

  return { score: Math.min(score, 100), reasons: reasons.slice(0, 4) };
}

export const CLEAN_MESSAGE = [
  "🌸 클린메시지 🌸",
  "- 상대방과 주선자에게 기본 에티켓을 지켜주세요.",
  "- 당일 파투 및 잠수는 금지입니다.",
  "- 빠른 회신 부탁드립니다.",
  "- 개인정보 무단 공유는 금지됩니다.",
].join("\n");

const PRIVACY_CHECKS = [
  { label: "전화번호", re: /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/ },
  { label: "이메일", re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { label: "SNS 아이디", re: /@[A-Za-z0-9._]{3,}|인스타|insta|카톡\s*아이디|카카오\s*아이디|텔레그램/i },
  { label: "상세 주소", re: /\d+\s*동\s*\d+\s*호|\d+번지|[가-힣]+아파트|[가-힣]+빌라/ },
  { label: "차량번호", re: /\d{2,3}[가-힣]\s?\d{4}/ },
  { label: "주민등록번호", re: /\d{6}[-\s]?\d{7}/ },
];

export function detectPrivacyRisks(text) {
  const value = String(text || "");
  return PRIVACY_CHECKS.filter((check) => check.re.test(value)).map((check) => check.label);
}

// "라벨 : 값" 형식에서 라벨을 인식하기 위한 매핑. 앞쪽 항목이 우선합니다.
const PROFILE_LABELS = [
  { field: "location", keys: ["거주지", "거주", "사는곳", "지역", "위치", "동네"] },
  { field: "job", keys: ["직장", "직업", "회사", "하는일", "업종", "근무"] },
  { field: "education", keys: ["학력", "학교", "전공", "최종학력"] },
  { field: "height", keys: ["키", "신장"] },
  { field: "birthYear", keys: ["나이", "출생연도", "출생", "생년", "연령"] },
  { field: "mbti", keys: ["mbti", "엠비티아이"] },
  { field: "ideal", keys: ["이상형", "선호스타일", "원하는상대", "선호"] },
  { field: "hobbies", keys: ["취미", "관심사"] },
  { field: "personality", keys: ["성격", "성향"] },
  { field: "religion", keys: ["종교"] },
  { field: "smoke", keys: ["흡연", "담배"] },
  { field: "drink", keys: ["음주", "술"] },
  { field: "gender", keys: ["성별"] },
  { field: "alias", keys: ["이름", "별칭", "닉네임", "별명"] },
  { field: "contact", keys: ["연락처", "전화번호", "전화", "카톡아이디", "연락"] },
  { field: "memo", keys: ["메모", "특이사항", "비고", "기타"] },
];

function birthYearFromValue(value) {
  const explicit = value.match(/(\d{4})\s*년?생?/);
  if (explicit) return Number(explicit[1]);
  const short = value.match(/(\d{2})\s*년생/);
  if (short) {
    const year = Number(short[1]);
    return year > 40 ? 1900 + year : 2000 + year;
  }
  const ageMatch = value.match(/(\d{1,2})\s*(?:세|살)?/);
  if (ageMatch) return CURRENT_YEAR - Number(ageMatch[1]);
  return null;
}

function assignProfileField(result, field, rawValue) {
  const value = String(rawValue).trim();
  if (!value) return;
  switch (field) {
    case "height": {
      const match = value.match(/(\d{2,3})/);
      if (match) result.height = Number(match[1]);
      break;
    }
    case "birthYear": {
      const year = birthYearFromValue(value);
      if (year) result.birthYear = year;
      break;
    }
    case "religion":
      result.religion = value.match(/무교|기독교|천주교|불교/)?.[0] || value;
      break;
    case "smoke":
      result.smoke = /비흡연|안\s*피|금연/.test(value) ? "비흡연" : "흡연";
      break;
    case "drink":
      result.drink = /안\s*함|안\s*마|못\s*마|금주/.test(value) ? "안함" : /자주|즐/.test(value) ? "자주" : "가끔";
      break;
    case "gender":
      if (/남/.test(value)) result.gender = "남";
      else if (/여/.test(value)) result.gender = "여";
      break;
    case "mbti": {
      const match = value.match(/[EI][NS][FT][JP]/i);
      result.mbti = match ? match[0].toUpperCase() : value.toUpperCase();
      break;
    }
    default:
      result[field] = value;
  }
}

export function parseRawProfile(raw) {
  const text = raw.replace(/\n/g, " / ");
  const chunks = text.split("/").map((chunk) => chunk.trim()).filter(Boolean);
  const result = {};
  const unlabeled = [];

  // 1) "라벨 : 값" 형식 우선 처리
  chunks.forEach((chunk) => {
    const match = chunk.match(/^([^:：]{1,12})[:：]\s*(.+)$/);
    if (match) {
      const label = normalize(match[1]);
      const entry = PROFILE_LABELS.find((item) => item.keys.some((key) => label.includes(normalize(key))));
      if (entry) {
        assignProfileField(result, entry.field, match[2]);
        return;
      }
    }
    unlabeled.push(chunk);
  });

  // 2) 라벨이 없는 부분에서 전체 추출(이미 채워진 값은 보존)
  const restText = unlabeled.join(" / ");
  if (!result.birthYear) {
    const yearMatch = restText.match(/(\d{2,4})\s*년생/);
    if (yearMatch) {
      const year = Number(yearMatch[1]);
      result.birthYear = year < 100 ? (year > 40 ? 1900 + year : 2000 + year) : year;
    } else {
      const ageMatch = restText.match(/(\d{1,2})\s*(?:세|살)/);
      if (ageMatch) result.birthYear = CURRENT_YEAR - Number(ageMatch[1]);
    }
  }
  if (!result.height) {
    const heightMatch = restText.match(/(?:^|[^\d])(?:키\s*)?(\d{3})(?!\d)\s*(?:cm|센치)?/i);
    if (heightMatch) result.height = Number(heightMatch[1]);
  }
  if (!result.mbti) {
    const mbtiMatch = restText.match(/\b[EI][NS][FT][JP]\b/i);
    if (mbtiMatch) result.mbti = mbtiMatch[0].toUpperCase();
  }
  if (!result.gender) {
    if (/남성| 남 |남자/.test(text)) result.gender = "남";
    if (/여성| 여 |여자/.test(text)) result.gender = "여";
  }

  // 3) 라벨 없는 조각의 키워드 기반 분류(이미 채워진 값은 보존)
  unlabeled.forEach((chunk) => {
    if (!result.location && /거주|인근|쪽|[가-힣]동(?![가-힣])|[가-힣]구(?![가-힣])|역|분당|판교|강남|마포|김포/.test(chunk)) result.location = chunk.replace(/거주\s*중?|인근/g, "").trim();
    else if (!result.education && /[가-힣]대(?![가-힣])|학부|졸|석사|박사|학과/.test(chunk)) result.education = chunk;
    else if (!result.hobbies && /취미/.test(chunk)) result.hobbies = chunk.replace(/취미[:\s]*/g, "").trim();
    else if (!result.personality && /성격|외향|내향|긍정|차분|신중|밝|다정/.test(chunk)) result.personality = chunk.replace(/성격|인|이고|적인|편/g, " ").replace(/\s+/g, " ").trim();
    else if (!result.religion && /무교|기독교|천주교|불교/.test(chunk)) result.religion = chunk.match(/무교|기독교|천주교|불교/)?.[0];
    else if (!result.smoke && /흡연|비흡연/.test(chunk)) result.smoke = chunk.includes("비흡연") ? "비흡연" : "흡연";
    else if (!result.drink && /음주|술/.test(chunk)) result.drink = /안\s*함|안\s*마|못\s*마/.test(chunk) ? "안함" : /자주|즐/.test(chunk) ? "자주" : "가끔";
    else if (!result.job && /년차|은행|자동차|보험|공무원|회사|개발|기획|변호사|로펌|직장/.test(chunk)) result.job = chunk;
  });

  if (!result.alias && result.birthYear) result.alias = `${String(result.birthYear).slice(2)}년생 ${result.gender || "여"}성 신규`;
  return result;
}

export function shareMessage(candidate, tone, includeClean = false) {
  const lines = {
    clean: ["소개 후보 공유", "", `- 나이: ${candidate.birthYear}년생`, `- 거주지: ${candidate.location}`, `- 키: ${candidate.height || "-"}cm`, `- 학력: ${candidate.education}`, `- 직장: ${candidate.job}`, `- 성격: ${candidate.personality}`, `- 취미: ${candidate.hobbies}`, `- 특이사항: ${candidate.mbti || "미입력"}, ${candidate.smoke}`, "", "기본 매너를 갖춘 분과 진지한 만남을 선호합니다."],
    natural: [`${candidate.birthYear}년생 ${candidate.gender === "여" ? "여성" : "남성"}분 소개드립니다.`, "", `${candidate.location} 거주 중이고, ${candidate.education} 후 ${candidate.job}에서 근무 중입니다. 키는 ${candidate.height || "-"}cm이며, ${candidate.hobbies} 같은 취미를 즐기는 분입니다.`, "", `성격은 ${candidate.personality}인 편이고, ${candidate.ideal}을 선호합니다. 기본적인 소개팅 매너를 지켜주실 분이면 좋겠습니다.`],
    openchat: ["소개 후보 공유", "", `${candidate.birthYear}년생 ${candidate.gender} / ${candidate.location}`, `${candidate.height || "-"}cm / ${candidate.education} / ${candidate.job}`, `${candidate.mbti || "MBTI 미입력"} / ${candidate.personality}`, `취미: ${candidate.hobbies}`, "", "관심 있으시면 주선자에게 확인 부탁드립니다."],
    formal: [`${candidate.birthYear}년생 ${candidate.gender === "여" ? "여성" : "남성"} 후보를 정중히 소개드립니다.`, "", `현재 ${candidate.location}에 거주하고 있으며, ${candidate.education} 이력을 가지고 있습니다. 직장 및 직무는 ${candidate.job}으로 기록되어 있습니다.`, "", `성향은 ${candidate.personality}이고 취미는 ${candidate.hobbies}입니다. ${candidate.ideal}과의 만남을 선호합니다.`],
  };
  const body = lines[tone].join("\n");
  return includeClean ? `${body}\n\n${CLEAN_MESSAGE}` : body;
}
