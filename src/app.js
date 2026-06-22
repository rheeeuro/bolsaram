const CURRENT_YEAR = new Date().getFullYear();
const STORAGE_KEY = "bolsaram-candidates";
const LOG_KEY = "bolsaram-logs";

const statuses = [
  "등록됨",
  "소개 가능",
  "검토 중",
  "제안 완료",
  "수락",
  "연락처 교환",
  "만남 예정",
  "만남 완료",
  "거절",
  "보류",
  "매칭 완료",
];

const sampleCandidates = [
  {
    id: "c-1",
    alias: "95년생 여성 A",
    gender: "여",
    birthYear: 1995,
    height: 163,
    location: "김포공항역 인근",
    job: "현대자동차 7년차",
    education: "연세대 학부졸",
    religion: "무교",
    smoke: "비흡연",
    drink: "가끔",
    mbti: "ESFJ",
    personality: "외향적, 긍정적",
    hobbies: "헬스, 수영, 러닝",
    ideal: "배려심 있고 선한 사람",
    memo: "활동적이고 대화가 밝은 스타일",
    privacy: "그룹 내 공개",
    status: "소개 가능",
    createdAt: "2026-06-21T08:20:00.000Z",
    color: "#2f7d69",
  },
  {
    id: "c-2",
    alias: "92년생 남성 B",
    gender: "남",
    birthYear: 1992,
    height: 178,
    location: "삼성동",
    job: "우리은행 본점",
    education: "성균관대",
    religion: "무교",
    smoke: "비흡연",
    drink: "가끔",
    mbti: "ISTJ",
    personality: "차분함, 책임감",
    hobbies: "러닝, 와인, 독서",
    ideal: "밝고 자기 일이 있는 사람",
    memo: "안정적인 직장 선호 조건에 잘 맞음",
    privacy: "그룹 내 공개",
    status: "검토 중",
    createdAt: "2026-06-20T07:20:00.000Z",
    color: "#386fa4",
  },
  {
    id: "c-3",
    alias: "89년생 남성 C",
    gender: "남",
    birthYear: 1989,
    height: 181,
    location: "분당 야탑",
    job: "외국계 보험사",
    education: "중앙대",
    religion: "기독교",
    smoke: "비흡연",
    drink: "안함",
    mbti: "ENFJ",
    personality: "다정함, 리드형",
    hobbies: "등산, 헬스, 맛집",
    ideal: "가치관이 선하고 대화가 잘 되는 사람",
    memo: "종교 조건 확인 필요",
    privacy: "전체 공개",
    status: "소개 가능",
    createdAt: "2026-06-18T04:10:00.000Z",
    color: "#a87620",
  },
  {
    id: "c-4",
    alias: "94년생 여성 D",
    gender: "여",
    birthYear: 1994,
    height: 160,
    location: "판교",
    job: "IT 서비스 기획자",
    education: "한양대",
    religion: "무교",
    smoke: "비흡연",
    drink: "가끔",
    mbti: "INFJ",
    personality: "신중함, 배려심",
    hobbies: "필라테스, 전시, 산책",
    ideal: "예의 있고 안정적인 사람",
    memo: "진지한 만남 선호",
    privacy: "그룹 내 공개",
    status: "제안 완료",
    createdAt: "2026-06-17T02:00:00.000Z",
    color: "#c7604d",
  },
  {
    id: "c-5",
    alias: "90년생 남성 E",
    gender: "남",
    birthYear: 1990,
    height: 175,
    location: "마포",
    job: "공무원",
    education: "서울시립대",
    religion: "천주교",
    smoke: "미입력",
    drink: "가끔",
    mbti: "ISFP",
    personality: "온화함, 유머",
    hobbies: "영화, 요리, 자전거",
    ideal: "편안하게 대화가 이어지는 사람",
    memo: "흡연 여부 재확인",
    privacy: "비공개",
    status: "보류",
    createdAt: "2026-06-16T03:30:00.000Z",
    color: "#5c6f45",
  },
  {
    id: "c-6",
    alias: "97년생 여성 F",
    gender: "여",
    birthYear: 1997,
    height: 168,
    location: "강남역",
    job: "로펌 변호사",
    education: "고려대",
    religion: "무교",
    smoke: "비흡연",
    drink: "자주",
    mbti: "ENTP",
    personality: "솔직함, 에너지",
    hobbies: "클라이밍, 여행, 러닝",
    ideal: "대화 텐션이 맞고 자기관리하는 사람",
    memo: "전문직 선호 그룹에서 문의 많음",
    privacy: "그룹 내 공개",
    status: "소개 가능",
    createdAt: "2026-06-15T10:30:00.000Z",
    color: "#7c4d8b",
  },
];

const sampleLogs = [
  {
    id: "l-1",
    pair: ["c-1", "c-2"],
    status: "검토 중",
    date: "2026.06.21",
    memo: "후보 추천, 주선자 검토 시작",
  },
  {
    id: "l-2",
    pair: ["c-4", "c-2"],
    status: "제안 완료",
    date: "2026.06.20",
    memo: "B님에게 D님 프로필 전달",
  },
  {
    id: "l-3",
    pair: ["c-3", "c-1"],
    status: "종료",
    date: "2026.06.19",
    memo: "거리와 종교 조건으로 보류",
  },
];

let candidates = load(STORAGE_KEY, sampleCandidates);
let logs = load(LOG_KEY, sampleLogs);
let selectedId = candidates[0]?.id ?? null;
let sortMode = "recent";

const $ = (selector) => document.querySelector(selector);
const listEl = $("#candidateList");
const detailContent = $("#detailContent");
const emptyState = $("#emptyState");
const dialog = $("#candidateDialog");
const form = $("#candidateForm");
const toast = $("#toast");

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(candidates));
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}

function age(candidate) {
  return CURRENT_YEAR - Number(candidate.birthYear);
}

function initials(candidate) {
  return candidate.alias.replace(/\s/g, "").slice(-1) || "?";
}

function splitWords(value) {
  return String(value || "")
    .split(/[,\s/·]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s/g, "");
}

function jobGroup(job) {
  const text = normalize(job);
  if (/은행|금융|보험|증권/.test(text)) return "금융";
  if (/현대|삼성|lg|sk|자동차|대기업/.test(text)) return "대기업";
  if (/공무원|공공/.test(text)) return "공무원";
  if (/it|개발|기획|서비스|테크/.test(text)) return "IT";
  if (/변호사|의사|회계사|전문직|로펌/.test(text)) return "전문직";
  return "기타";
}

function statusTone(status) {
  if (["소개 가능", "수락", "연락처 교환", "만남 예정"].includes(status)) return "good";
  if (["보류", "거절"].includes(status)) return "risk";
  if (["검토 중", "제안 완료"].includes(status)) return "warn";
  return "neutral";
}

function candidateSearchText(candidate) {
  return normalize([
    candidate.alias,
    candidate.gender,
    candidate.location,
    candidate.job,
    candidate.education,
    candidate.religion,
    candidate.smoke,
    candidate.drink,
    candidate.mbti,
    candidate.personality,
    candidate.hobbies,
    candidate.ideal,
    candidate.memo,
    candidate.status,
  ].join(" "));
}

function getFilters() {
  return {
    search: normalize($("#searchInput").value),
    gender: $("#genderFilter").value,
    minAge: Number($("#minAgeFilter").value) || null,
    maxAge: Number($("#maxAgeFilter").value) || null,
    minHeight: Number($("#minHeightFilter").value) || null,
    region: normalize($("#regionFilter").value),
    job: $("#jobFilter").value,
    religion: $("#religionFilter").value,
    nonSmoker: $("#nonSmokerFilter").checked,
    status: $("#statusFilter").value,
  };
}

function filteredCandidates() {
  const filters = getFilters();
  const selected = getSelected();
  return candidates
    .filter((candidate) => {
      if (filters.search && !candidateSearchText(candidate).includes(filters.search)) return false;
      if (filters.gender !== "all" && candidate.gender !== filters.gender) return false;
      if (filters.minAge && age(candidate) < filters.minAge) return false;
      if (filters.maxAge && age(candidate) > filters.maxAge) return false;
      if (filters.minHeight && Number(candidate.height) < filters.minHeight) return false;
      if (filters.region && !normalize(candidate.location).includes(filters.region)) return false;
      if (filters.job !== "all" && jobGroup(candidate.job) !== filters.job) return false;
      if (filters.religion !== "all" && candidate.religion !== filters.religion) return false;
      if (filters.nonSmoker && candidate.smoke !== "비흡연") return false;
      if (filters.status !== "all" && candidate.status !== filters.status) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "score" && selected) {
        return matchScore(selected, b).score - matchScore(selected, a).score;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function render() {
  renderStats();
  renderList();
  renderDetail();
}

function renderStats() {
  const available = candidates.filter((candidate) => candidate.status === "소개 가능").length;
  const reviewing = candidates.filter((candidate) => ["검토 중", "제안 완료"].includes(candidate.status)).length;
  const duplicates = duplicateCandidates().length;
  $("#statsStrip").innerHTML = [
    statRow("전체 후보", candidates.length),
    statRow("소개 가능", available),
    statRow("진행 중", reviewing),
    statRow("중복 의심", duplicates),
  ].join("");
}

function statRow(label, value) {
  return `<div class="stat-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderList() {
  const rows = filteredCandidates();
  $("#resultCount").textContent = `${rows.length}명`;
  listEl.innerHTML = rows
    .map(
      (candidate) => `
        <button class="candidate-card ${candidate.id === selectedId ? "active" : ""}" type="button" data-id="${candidate.id}">
          <div class="avatar" style="background:${candidate.color}">${initials(candidate)}</div>
          <div class="card-main">
            <div class="card-title">
              <h3>${candidate.alias}</h3>
              <span>${age(candidate)}세</span>
            </div>
            <p class="card-meta">${candidate.location} · ${candidate.job}<br>${candidate.height}cm · ${candidate.education}</p>
            <div class="tag-row">
              <span class="tag">${candidate.status}</span>
              <span class="tag">${candidate.smoke}</span>
              <span class="tag accent">${jobGroup(candidate.job)}</span>
            </div>
          </div>
        </button>
      `,
    )
    .join("");

  listEl.querySelectorAll(".candidate-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedId = card.dataset.id;
      render();
    });
  });
}

function getSelected() {
  return candidates.find((candidate) => candidate.id === selectedId) || candidates[0] || null;
}

function renderDetail() {
  const candidate = getSelected();
  if (!candidate) {
    emptyState.classList.remove("hidden");
    detailContent.classList.add("hidden");
    return;
  }

  selectedId = candidate.id;
  emptyState.classList.add("hidden");
  detailContent.classList.remove("hidden");

  $("#detailAvatar").style.background = candidate.color;
  $("#detailAvatar").textContent = initials(candidate);
  $("#detailName").textContent = candidate.alias;
  $("#detailStatus").textContent = candidate.status;
  $("#detailSummary").textContent = `${age(candidate)}세 · ${candidate.location} · ${candidate.job}`;
  $("#detailTags").innerHTML = [candidate.mbti, candidate.smoke, candidate.religion, candidate.privacy]
    .filter(Boolean)
    .map((tag) => `<span class="tag">${tag}</span>`)
    .join("");

  $("#profileFacts").innerHTML = [
    ["성별", candidate.gender],
    ["출생연도", `${candidate.birthYear}년`],
    ["키", `${candidate.height || "-"}cm`],
    ["학력", candidate.education || "-"],
    ["종교", candidate.religion || "-"],
    ["음주", candidate.drink || "-"],
    ["성격", candidate.personality || "-"],
    ["취미", candidate.hobbies || "-"],
    ["이상형", candidate.ideal || "-"],
    ["메모", candidate.memo || "-"],
  ]
    .map(([label, value]) => `<div class="fact-row"><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");

  $("#operatorChecks").innerHTML = operatorChecks(candidate)
    .map(
      (check) => `
        <div class="check-item">
          <span class="check-dot ${check.level}"></span>
          <span>${check.text}</span>
        </div>
      `,
    )
    .join("");

  $("#statusSelect").innerHTML = statuses
    .map((status) => `<option value="${status}" ${status === candidate.status ? "selected" : ""}>${status}</option>`)
    .join("");

  renderRecommendations(candidate);
  renderTimeline(candidate);
  renderShareText(candidate);
}

function operatorChecks(candidate) {
  const checks = [];
  const duplicate = duplicateCandidates(candidate)[0];
  checks.push({
    level: duplicate ? "risk" : "",
    text: duplicate ? `${duplicate.alias} 후보와 중복 가능성이 있습니다.` : "중복 의심 항목이 없습니다.",
  });
  checks.push({
    level: candidate.privacy === "비공개" ? "warn" : "",
    text: `${candidate.privacy} 상태입니다.`,
  });
  checks.push({
    level: candidate.smoke === "미입력" ? "warn" : "",
    text: candidate.smoke === "미입력" ? "흡연 여부 재확인이 필요합니다." : `${candidate.smoke}으로 기록되어 있습니다.`,
  });
  checks.push({
    level: ["거절", "보류", "매칭 완료"].includes(candidate.status) ? "risk" : "",
    text: `현재 상태는 ${candidate.status}입니다.`,
  });
  return checks;
}

function duplicateCandidates(base = null) {
  const duplicates = [];
  candidates.forEach((candidate, index) => {
    candidates.slice(index + 1).forEach((other) => {
      const sameProfile =
        candidate.gender === other.gender &&
        Math.abs(candidate.birthYear - other.birthYear) <= 1 &&
        normalize(candidate.location) === normalize(other.location) &&
        normalize(candidate.job).slice(0, 4) === normalize(other.job).slice(0, 4);
      const sameAlias = normalize(candidate.alias) && normalize(candidate.alias) === normalize(other.alias);
      if (sameProfile || sameAlias) {
        if (!base || candidate.id === base.id || other.id === base.id) {
          duplicates.push(candidate.id === base?.id ? other : candidate);
        }
      }
    });
  });
  return duplicates;
}

function renderRecommendations(candidate) {
  const recommendations = candidates
    .filter((other) => other.id !== candidate.id && other.gender !== candidate.gender)
    .map((other) => ({ candidate: other, ...matchScore(candidate, other) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  $("#recommendationList").innerHTML =
    recommendations
      .map(
        (item) => `
          <div class="recommendation-card">
            <div class="score-ring" style="--score:${item.score * 3.6}deg"><span>${item.score}</span></div>
            <div>
              <h4>${item.candidate.alias}</h4>
              <p>${item.candidate.birthYear}년생 · ${item.candidate.job} · ${item.candidate.location}<br>${item.reasons.join(" · ")}</p>
            </div>
            <button class="secondary-button compact" type="button" data-pair="${item.candidate.id}">
              검토
            </button>
          </div>
        `,
      )
      .join("") || `<div class="recommendation-card"><p>추천 가능한 상대 후보가 없습니다.</p></div>`;

  $("#recommendationList").querySelectorAll("[data-pair]").forEach((button) => {
    button.addEventListener("click", () => addReviewLog(candidate.id, button.dataset.pair));
  });
}

function matchScore(a, b) {
  let score = 0;
  const reasons = [];
  const ageDiff = Math.abs(age(a) - age(b));
  const aHobbies = splitWords(a.hobbies);
  const bHobbies = splitWords(b.hobbies);
  const sharedHobbies = aHobbies.filter((hobby) => bHobbies.includes(hobby));
  const sameReligion = a.religion === b.religion || a.religion === "미입력" || b.religion === "미입력";
  const smokeOk = a.smoke === b.smoke || a.smoke === "미입력" || b.smoke === "미입력";
  const regionClose = closeRegion(a.location, b.location);
  const idealHit = splitWords(a.ideal).some((word) => normalize(b.personality).includes(normalize(word)));
  const complementaryMbti = a.mbti && b.mbti && a.mbti[0] !== b.mbti[0];

  if (ageDiff <= 4) {
    score += 20;
    reasons.push("나이 차이 적절");
  } else if (ageDiff <= 7) {
    score += 12;
    reasons.push("나이 조건 검토 가능");
  }

  if (regionClose) {
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

  if (complementaryMbti) {
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

function closeRegion(a, b) {
  const groups = [
    ["강남", "삼성", "판교", "분당", "야탑"],
    ["김포", "마포", "공항", "서울"],
  ];
  const one = normalize(a);
  const two = normalize(b);
  return groups.some((group) => group.some((word) => one.includes(word)) && group.some((word) => two.includes(word)));
}

function renderTimeline(candidate) {
  const ownLogs = logs
    .filter((log) => log.pair.includes(candidate.id))
    .sort((a, b) => b.date.localeCompare(a.date));

  $("#timeline").innerHTML =
    ownLogs
      .map((log) => {
        const otherId = log.pair.find((id) => id !== candidate.id);
        const other = candidates.find((item) => item.id === otherId);
        return `
          <div class="timeline-item">
            <time>${log.date} · ${log.status}</time>
            ${candidate.alias} ↔ ${other?.alias || "상대 후보"}<br>${log.memo}
          </div>
        `;
      })
      .join("") || `<div class="timeline-item"><time>기록 없음</time>아직 연결 이력이 없습니다.</div>`;
}

function renderShareText(candidate) {
  $("#shareText").value = shareMessage(candidate, $("#toneSelect").value);
}

function shareMessage(candidate, tone) {
  const lines = {
    clean: [
      `소개 후보 공유`,
      ``,
      `- 나이: ${candidate.birthYear}년생`,
      `- 거주지: ${candidate.location}`,
      `- 키: ${candidate.height}cm`,
      `- 학력: ${candidate.education}`,
      `- 직장: ${candidate.job}`,
      `- 성격: ${candidate.personality}`,
      `- 취미: ${candidate.hobbies}`,
      `- 특이사항: ${candidate.mbti || "미입력"}, ${candidate.smoke}`,
      ``,
      `기본 매너를 갖춘 분과 진지한 만남을 선호합니다.`,
    ],
    natural: [
      `${candidate.birthYear}년생 ${candidate.gender === "여" ? "여성" : "남성"}분 소개드립니다.`,
      ``,
      `${candidate.location} 거주 중이고, ${candidate.education} 후 ${candidate.job}에서 근무 중입니다. 키는 ${candidate.height}cm이며, ${candidate.hobbies} 같은 취미를 즐기는 분입니다.`,
      ``,
      `성격은 ${candidate.personality}인 편이고, ${candidate.ideal}을 선호합니다. 기본적인 소개팅 매너를 지켜주실 분이면 좋겠습니다.`,
    ],
    openchat: [
      `소개 후보 공유`,
      ``,
      `${candidate.birthYear}년생 ${candidate.gender} / ${candidate.location}`,
      `${candidate.height}cm / ${candidate.education} / ${candidate.job}`,
      `${candidate.mbti || "MBTI 미입력"} / ${candidate.personality}`,
      `취미: ${candidate.hobbies}`,
      ``,
      `관심 있으시면 주선자에게 확인 부탁드립니다.`,
    ],
    formal: [
      `${candidate.birthYear}년생 ${candidate.gender === "여" ? "여성" : "남성"} 후보를 정중히 소개드립니다.`,
      ``,
      `현재 ${candidate.location}에 거주하고 있으며, ${candidate.education} 이력을 가지고 있습니다. 직장 및 직무는 ${candidate.job}으로 기록되어 있습니다.`,
      ``,
      `성향은 ${candidate.personality}이고 취미는 ${candidate.hobbies}입니다. ${candidate.ideal}과의 만남을 선호합니다.`,
    ],
  };
  return lines[tone].join("\n");
}

function addReviewLog(candidateId, otherId = null) {
  const base = candidates.find((candidate) => candidate.id === candidateId);
  const other =
    candidates.find((candidate) => candidate.id === otherId) ||
    candidates
      .filter((candidate) => candidate.id !== candidateId && candidate.gender !== base.gender)
      .map((candidate) => ({ candidate, score: matchScore(base, candidate).score }))
      .sort((a, b) => b.score - a.score)[0]?.candidate;

  if (!base || !other) return;

  logs.unshift({
    id: uid("l"),
    pair: [base.id, other.id],
    status: "검토 중",
    date: formatDate(new Date()),
    memo: "추천 후보 검토 등록",
  });
  base.status = "검토 중";
  save();
  render();
  showToast("검토 로그를 추가했습니다.");
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

function parseRawProfile(raw) {
  const text = raw.replace(/\n/g, " / ");
  const chunks = text
    .split("/")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const result = {};

  const yearMatch = text.match(/(\d{2,4})\s*년생/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    result.birthYear = year < 100 ? (year > 40 ? 1900 + year : 2000 + year) : year;
  }

  const heightMatch = text.match(/(?:^|[^\d])(?:키\s*)?(\d{3})(?!\d)\s*(?:cm|센치)?/i);
  if (heightMatch) result.height = Number(heightMatch[1]);

  const mbtiMatch = text.match(/\b[EI][NS][FT][JP]\b/i);
  if (mbtiMatch) result.mbti = mbtiMatch[0].toUpperCase();

  if (/남성| 남 |남자/.test(text)) result.gender = "남";
  if (/여성| 여 |여자/.test(text)) result.gender = "여";

  chunks.forEach((chunk) => {
    if (/거주|쪽|역|동|구|분당|판교|강남|마포|김포/.test(chunk)) {
      result.location = chunk.replace(/거주\s*중?|거주|인근/g, "").trim();
    } else if (/대|학부|졸|석사|박사/.test(chunk)) {
      result.education = chunk;
    } else if (/취미/.test(chunk)) {
      result.hobbies = chunk.replace(/취미[:\s]*/g, "").trim();
    } else if (/성격|외향|내향|긍정|차분|신중|밝|다정/.test(chunk)) {
      result.personality = chunk.replace(/성격|인|이고|적인|편/g, " ").replace(/\s+/g, " ").trim();
    } else if (/무교|기독교|천주교|불교/.test(chunk)) {
      result.religion = chunk.match(/무교|기독교|천주교|불교/)?.[0];
    } else if (/흡연|비흡연/.test(chunk)) {
      result.smoke = chunk.includes("비흡연") ? "비흡연" : "흡연";
    } else if (/년차|은행|자동차|보험|공무원|회사|개발|기획|변호사|로펌|직장/.test(chunk)) {
      result.job = chunk;
    }
  });

  if (!result.alias && result.birthYear) {
    result.alias = `${String(result.birthYear).slice(2)}년생 ${result.gender || "여"}성 신규`;
  }
  return result;
}

function fillForm(values) {
  const map = {
    alias: "#aliasInput",
    gender: "#genderInput",
    birthYear: "#birthYearInput",
    height: "#heightInput",
    location: "#locationInput",
    job: "#jobInput",
    education: "#educationInput",
    religion: "#religionInput",
    smoke: "#smokeInput",
    drink: "#drinkInput",
    mbti: "#mbtiInput",
    personality: "#personalityInput",
    hobbies: "#hobbiesInput",
    ideal: "#idealInput",
    memo: "#memoInput",
    privacy: "#privacyInput",
  };
  Object.entries(map).forEach(([key, selector]) => {
    if (values[key] !== undefined) $(selector).value = values[key];
  });
  updateDuplicateNotice();
}

function formCandidate() {
  return {
    id: uid("c"),
    alias: $("#aliasInput").value.trim(),
    gender: $("#genderInput").value,
    birthYear: Number($("#birthYearInput").value),
    height: Number($("#heightInput").value),
    location: $("#locationInput").value.trim(),
    job: $("#jobInput").value.trim(),
    education: $("#educationInput").value.trim(),
    religion: $("#religionInput").value,
    smoke: $("#smokeInput").value,
    drink: $("#drinkInput").value,
    mbti: $("#mbtiInput").value.trim().toUpperCase(),
    personality: $("#personalityInput").value.trim(),
    hobbies: $("#hobbiesInput").value.trim(),
    ideal: $("#idealInput").value.trim(),
    memo: $("#memoInput").value.trim(),
    privacy: $("#privacyInput").value,
    status: "등록됨",
    createdAt: new Date().toISOString(),
    color: randomColor(),
  };
}

function randomColor() {
  const palette = ["#2f7d69", "#386fa4", "#c7604d", "#a87620", "#5c6f45", "#7c4d8b"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function updateDuplicateNotice() {
  const candidate = {
    id: "preview",
    alias: $("#aliasInput").value.trim(),
    gender: $("#genderInput").value,
    birthYear: Number($("#birthYearInput").value),
    location: $("#locationInput").value.trim(),
    job: $("#jobInput").value.trim(),
  };
  const duplicate = candidates.find((other) => {
    const sameAlias = normalize(other.alias) && normalize(other.alias) === normalize(candidate.alias);
    const sameProfile =
      other.gender === candidate.gender &&
      Math.abs(other.birthYear - candidate.birthYear) <= 1 &&
      normalize(other.location) === normalize(candidate.location) &&
      normalize(other.job).slice(0, 4) === normalize(candidate.job).slice(0, 4);
    return sameAlias || sameProfile;
  });
  $("#duplicateNotice").textContent = duplicate ? `${duplicate.alias} 후보와 중복 가능` : "";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function bindEvents() {
  [
    "#searchInput",
    "#genderFilter",
    "#minAgeFilter",
    "#maxAgeFilter",
    "#minHeightFilter",
    "#regionFilter",
    "#jobFilter",
    "#religionFilter",
    "#nonSmokerFilter",
    "#statusFilter",
  ].forEach((selector) => $(selector).addEventListener("input", render));

  $("#clearFiltersButton").addEventListener("click", () => {
    ["#searchInput", "#minAgeFilter", "#maxAgeFilter", "#minHeightFilter", "#regionFilter"].forEach((selector) => {
      $(selector).value = "";
    });
    $("#genderFilter").value = "all";
    $("#jobFilter").value = "all";
    $("#religionFilter").value = "all";
    $("#statusFilter").value = "all";
    $("#nonSmokerFilter").checked = false;
    render();
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      sortMode = button.dataset.sort;
      document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderList();
    });
  });

  $("#newCandidateButton").addEventListener("click", () => {
    form.reset();
    $("#duplicateNotice").textContent = "";
    dialog.showModal();
  });

  $("#closeDialogButton").addEventListener("click", () => dialog.close());
  $("#cancelDialogButton").addEventListener("click", () => dialog.close());

  $("#parseButton").addEventListener("click", () => {
    fillForm(parseRawProfile($("#rawTextInput").value));
    showToast("원문에서 필드를 분리했습니다.");
  });

  ["#aliasInput", "#birthYearInput", "#genderInput", "#locationInput", "#jobInput"].forEach((selector) => {
    $(selector).addEventListener("input", updateDuplicateNotice);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const candidate = formCandidate();
    candidates.unshift(candidate);
    selectedId = candidate.id;
    save();
    dialog.close();
    render();
    showToast("후보를 등록했습니다.");
  });

  $("#saveStatusButton").addEventListener("click", () => {
    const candidate = getSelected();
    candidate.status = $("#statusSelect").value;
    logs.unshift({
      id: uid("l"),
      pair: [candidate.id],
      status: candidate.status,
      date: formatDate(new Date()),
      memo: "후보 상태 변경",
    });
    save();
    render();
    showToast("상태를 저장했습니다.");
  });

  $("#addReviewLogButton").addEventListener("click", () => addReviewLog(getSelected().id));

  $("#toneSelect").addEventListener("change", () => renderShareText(getSelected()));

  $("#copyShareButton").addEventListener("click", async () => {
    await copyText(document.querySelector("#shareText").value);
    showToast("공유글을 복사했습니다.");
  });

  $("#resetButton").addEventListener("click", () => {
    candidates = structuredClone(sampleCandidates);
    logs = structuredClone(sampleLogs);
    selectedId = candidates[0].id;
    save();
    render();
    showToast("샘플 데이터를 복원했습니다.");
  });
}

bindEvents();
render();

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
