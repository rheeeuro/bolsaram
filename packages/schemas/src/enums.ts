/**
 * 도메인 열거형 단일 정의처.
 * DB enum, Zod 스키마, UI 라벨, AI 추출 스키마가 모두 이 파일을 참조한다.
 * 값(코드)은 영문 대문자, 사용자에게 보이는 문구는 한글 라벨로 분리한다.
 */

export const GENDERS = ["MALE", "FEMALE"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  MALE: "남성",
  FEMALE: "여성",
};

export const USER_ROLES = ["ADMIN", "MEMBER"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "주선자",
  MEMBER: "회원",
};

/** 설계문서 §9 Profile status */
export const PROFILE_STATUSES = [
  "ACTIVE",
  "MATCHING",
  "PAUSED",
  "INACTIVE",
  "ARCHIVED",
] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];
export const PROFILE_STATUS_LABELS: Record<ProfileStatus, string> = {
  ACTIVE: "공개",
  MATCHING: "매칭 진행",
  PAUSED: "일시중지",
  INACTIVE: "비활성",
  ARCHIVED: "보관",
};

/** Discover 리스트에 노출되는 상태. 그 외는 회원에게 보이지 않는다. */
export const DISCOVERABLE_PROFILE_STATUSES = ["ACTIVE", "MATCHING"] as const;

/**
 * visibility: status 와 직교하는 노출 축.
 * LISTED  — Discover 리스트/상세 모두 노출
 * UNLISTED— 리스트에서 감추고 직접 링크(관리자 공유)로만 상세 접근
 * PRIVATE — 관리자 외 접근 불가
 */
export const VISIBILITIES = ["LISTED", "UNLISTED", "PRIVATE"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  LISTED: "리스트 노출",
  UNLISTED: "링크 전용",
  PRIVATE: "비공개",
};

/**
 * 등록 동의를 어떻게 확인했는가 (마이그레이션 0019).
 * 프로필은 주선자가 남을 대신해 등록하므로, 게시하려면 기록이 있어야 한다.
 *
 * SYNTHETIC·LEGACY 는 **실제 동의가 아니다** — 각각 합성 시드와 「확인 필요」다.
 * 새로 게시할 때는 도메인 레이어가 이 둘을 거절한다.
 */
export const CONSENT_METHODS = ["KAKAO", "VERBAL", "WRITTEN", "SYNTHETIC", "LEGACY"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];
export const CONSENT_METHOD_LABELS: Record<ConsentMethod, string> = {
  KAKAO: "카카오톡 대화로 확인",
  VERBAL: "구두로 확인",
  WRITTEN: "서면·양식으로 확인",
  SYNTHETIC: "합성 데이터(동의 대상 아님)",
  LEGACY: "확인 필요",
};

/** 주선자가 직접 고를 수 있는 것 — 실제로 사람에게 확인한 방법만. */
export const RECORDABLE_CONSENT_METHODS = ["KAKAO", "VERBAL", "WRITTEN"] as const;
export type RecordableConsentMethod = (typeof RECORDABLE_CONSENT_METHODS)[number];

export const JOB_CATEGORIES = [
  "IT",
  "FINANCE",
  "PROFESSIONAL",
  "PUBLIC",
  "MARKETING",
  "DESIGN",
  "MEDICAL",
  "EDUCATION",
  "SERVICE",
  "BUSINESS",
  "ART",
  "OTHER",
] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];
export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  IT: "IT",
  FINANCE: "금융",
  PROFESSIONAL: "전문직",
  PUBLIC: "공기업·공무원",
  MARKETING: "마케팅",
  DESIGN: "디자인",
  MEDICAL: "의료",
  EDUCATION: "교육",
  SERVICE: "서비스",
  BUSINESS: "사업·경영",
  ART: "예술·미디어",
  OTHER: "기타",
};

/** 광역 단위. 리스트에서는 이 단위까지만 공개한다(설계문서 §5). */
export const REGIONS = [
  "SEOUL",
  "GYEONGGI",
  "INCHEON",
  "BUSAN",
  "DAEGU",
  "DAEJEON",
  "GWANGJU",
  "ULSAN",
  "SEJONG",
  "GANGWON",
  "CHUNGBUK",
  "CHUNGNAM",
  "JEONBUK",
  "JEONNAM",
  "GYEONGBUK",
  "GYEONGNAM",
  "JEJU",
  "OVERSEAS",
] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_LABELS: Record<Region, string> = {
  SEOUL: "서울",
  GYEONGGI: "경기",
  INCHEON: "인천",
  BUSAN: "부산",
  DAEGU: "대구",
  DAEJEON: "대전",
  GWANGJU: "광주",
  ULSAN: "울산",
  SEJONG: "세종",
  GANGWON: "강원",
  CHUNGBUK: "충북",
  CHUNGNAM: "충남",
  JEONBUK: "전북",
  JEONNAM: "전남",
  GYEONGBUK: "경북",
  GYEONGNAM: "경남",
  JEJU: "제주",
  OVERSEAS: "해외",
};

export const RELIGIONS = [
  "NONE",
  "CHRISTIAN",
  "CATHOLIC",
  "BUDDHIST",
  "WON_BUDDHIST",
  "OTHER",
] as const;
export type Religion = (typeof RELIGIONS)[number];
export const RELIGION_LABELS: Record<Religion, string> = {
  NONE: "무교",
  CHRISTIAN: "기독교",
  CATHOLIC: "천주교",
  BUDDHIST: "불교",
  WON_BUDDHIST: "원불교",
  OTHER: "기타",
};

export const SMOKING_LEVELS = ["NONE", "OCCASIONAL", "REGULAR"] as const;
export type Smoking = (typeof SMOKING_LEVELS)[number];
export const SMOKING_LABELS: Record<Smoking, string> = {
  NONE: "비흡연",
  OCCASIONAL: "가끔",
  REGULAR: "흡연",
};

export const DRINKING_LEVELS = ["NONE", "OCCASIONAL", "SOCIAL", "REGULAR"] as const;
export type Drinking = (typeof DRINKING_LEVELS)[number];
export const DRINKING_LABELS: Record<Drinking, string> = {
  NONE: "안 함",
  OCCASIONAL: "가끔",
  SOCIAL: "사회적 음주",
  REGULAR: "즐김",
};

export const MBTI_TYPES = [
  "ISTJ",
  "ISFJ",
  "INFJ",
  "INTJ",
  "ISTP",
  "ISFP",
  "INFP",
  "INTP",
  "ESTP",
  "ESFP",
  "ENFP",
  "ENTP",
  "ESTJ",
  "ESFJ",
  "ENFJ",
  "ENTJ",
] as const;
export type Mbti = (typeof MBTI_TYPES)[number];

export const EDUCATION_LEVELS = [
  "HIGH_SCHOOL",
  "ASSOCIATE",
  "BACHELOR",
  "MASTER",
  "DOCTORATE",
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  HIGH_SCHOOL: "고졸",
  ASSOCIATE: "전문학사",
  BACHELOR: "학사",
  MASTER: "석사",
  DOCTORATE: "박사",
};

/** 설계문서 §4 신청/수락 상태 기계 */
export const MATCH_REQUEST_STATUSES = [
  "REQUESTED",
  "ACCEPTED",
  "REJECTED",
  "CANCELED",
  "INTRODUCED",
  "CLOSED",
] as const;
export type MatchRequestStatus = (typeof MATCH_REQUEST_STATUSES)[number];
export const MATCH_REQUEST_STATUS_LABELS: Record<MatchRequestStatus, string> = {
  REQUESTED: "신청함",
  ACCEPTED: "수락됨",
  REJECTED: "거절됨",
  CANCELED: "취소됨",
  INTRODUCED: "연결됨",
  CLOSED: "종료",
};

/** 같은 두 사람 사이에 동시에 하나만 존재할 수 있는 상태(설계문서 §4 활성 중복 신청 금지). */
export const ACTIVE_MATCH_REQUEST_STATUSES = ["REQUESTED", "ACCEPTED", "INTRODUCED"] as const;

export const IMPORT_SOURCES = [
  "TELEGRAM",
  "KAKAO_SHARE",
  "MANUAL_UPLOAD",
  "SCREENSHOT",
  "TEXT",
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  TELEGRAM: "텔레그램",
  KAKAO_SHARE: "카카오톡 공유",
  MANUAL_UPLOAD: "직접 업로드",
  SCREENSHOT: "스크린샷",
  TEXT: "텍스트",
};

export const IMPORT_STATUSES = [
  "RECEIVED",
  "UPLOADING",
  "ANALYZING",
  "REVIEW_REQUIRED",
  "READY",
  "IMPORTED",
  "FAILED",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  RECEIVED: "수신됨",
  UPLOADING: "업로드 중",
  ANALYZING: "분석 중",
  REVIEW_REQUIRED: "검토 필요",
  READY: "검토 완료",
  IMPORTED: "등록됨",
  FAILED: "실패",
};

export const IMPORT_ASSET_TYPES = ["IMAGE", "FILE"] as const;
export type ImportAssetType = (typeof IMPORT_ASSET_TYPES)[number];

/**
 * 텔레그램 봇 대화 상태. import_status 와 축이 다르다 —
 * 이건 "대화가 어디까지 왔는가", 저건 "Import 가 어디까지 왔는가"다.
 * db/migrations/0008_telegram.sql 의 telegram_session_state 와 1:1 로 대응한다.
 */
export const TELEGRAM_SESSION_STATES = [
  "WAITING_MEDIA",
  "WAITING_TEXT",
  "READY",
  "CANCELED",
  "EXPIRED",
] as const;
export type TelegramSessionState = (typeof TELEGRAM_SESSION_STATES)[number];
export const TELEGRAM_SESSION_STATE_LABELS: Record<TelegramSessionState, string> = {
  WAITING_MEDIA: "사진 대기",
  WAITING_TEXT: "프로필 글 대기",
  READY: "분석 대기",
  CANCELED: "취소됨",
  EXPIRED: "만료됨",
};
