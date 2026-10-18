/**
 * 서울·경기의 세부 지역 — 구·시·군(`DISTRICTS`)과 필터가 묶어 보여주는 권역(`AREAS`).
 *
 * 프로필에는 구·시·군만 저장한다(`profiles.residence_district`). 권역은 이 파일의 표가
 * 정하는 묶음이라 저장하지 않는다 — 경계를 옮겨도 데이터를 다시 뽑을 필요가 없다.
 * 코드 앞부분이 광역(`REGIONS`) 코드이고, DB 제약도 같은 규칙으로 광역과 맞춘다(0073).
 */
import type { Region } from "./enums";

export const DISTRICTS = [
  // 서울 25개 구
  "SEOUL_JONGNO",
  "SEOUL_JUNG",
  "SEOUL_YONGSAN",
  "SEOUL_SEONGDONG",
  "SEOUL_GWANGJIN",
  "SEOUL_DONGDAEMUN",
  "SEOUL_JUNGNANG",
  "SEOUL_SEONGBUK",
  "SEOUL_GANGBUK",
  "SEOUL_DOBONG",
  "SEOUL_NOWON",
  "SEOUL_EUNPYEONG",
  "SEOUL_SEODAEMUN",
  "SEOUL_MAPO",
  "SEOUL_YANGCHEON",
  "SEOUL_GANGSEO",
  "SEOUL_GURO",
  "SEOUL_GEUMCHEON",
  "SEOUL_YEONGDEUNGPO",
  "SEOUL_DONGJAK",
  "SEOUL_GWANAK",
  "SEOUL_SEOCHO",
  "SEOUL_GANGNAM",
  "SEOUL_SONGPA",
  "SEOUL_GANGDONG",
  // 경기 31개 시·군
  "GYEONGGI_SUWON",
  "GYEONGGI_SEONGNAM",
  "GYEONGGI_UIJEONGBU",
  "GYEONGGI_ANYANG",
  "GYEONGGI_BUCHEON",
  "GYEONGGI_GWANGMYEONG",
  "GYEONGGI_PYEONGTAEK",
  "GYEONGGI_DONGDUCHEON",
  "GYEONGGI_ANSAN",
  "GYEONGGI_GOYANG",
  "GYEONGGI_GWACHEON",
  "GYEONGGI_GURI",
  "GYEONGGI_NAMYANGJU",
  "GYEONGGI_OSAN",
  "GYEONGGI_SIHEUNG",
  "GYEONGGI_GUNPO",
  "GYEONGGI_UIWANG",
  "GYEONGGI_HANAM",
  "GYEONGGI_YONGIN",
  "GYEONGGI_PAJU",
  "GYEONGGI_ICHEON",
  "GYEONGGI_ANSEONG",
  "GYEONGGI_GIMPO",
  "GYEONGGI_HWASEONG",
  "GYEONGGI_GWANGJU",
  "GYEONGGI_YANGJU",
  "GYEONGGI_POCHEON",
  "GYEONGGI_YEOJU",
  "GYEONGGI_YEONCHEON",
  "GYEONGGI_GAPYEONG",
  "GYEONGGI_YANGPYEONG",
] as const;
export type District = (typeof DISTRICTS)[number];

export const DISTRICT_LABELS: Record<District, string> = {
  SEOUL_JONGNO: "종로구",
  SEOUL_JUNG: "중구",
  SEOUL_YONGSAN: "용산구",
  SEOUL_SEONGDONG: "성동구",
  SEOUL_GWANGJIN: "광진구",
  SEOUL_DONGDAEMUN: "동대문구",
  SEOUL_JUNGNANG: "중랑구",
  SEOUL_SEONGBUK: "성북구",
  SEOUL_GANGBUK: "강북구",
  SEOUL_DOBONG: "도봉구",
  SEOUL_NOWON: "노원구",
  SEOUL_EUNPYEONG: "은평구",
  SEOUL_SEODAEMUN: "서대문구",
  SEOUL_MAPO: "마포구",
  SEOUL_YANGCHEON: "양천구",
  SEOUL_GANGSEO: "강서구",
  SEOUL_GURO: "구로구",
  SEOUL_GEUMCHEON: "금천구",
  SEOUL_YEONGDEUNGPO: "영등포구",
  SEOUL_DONGJAK: "동작구",
  SEOUL_GWANAK: "관악구",
  SEOUL_SEOCHO: "서초구",
  SEOUL_GANGNAM: "강남구",
  SEOUL_SONGPA: "송파구",
  SEOUL_GANGDONG: "강동구",
  GYEONGGI_SUWON: "수원시",
  GYEONGGI_SEONGNAM: "성남시",
  GYEONGGI_UIJEONGBU: "의정부시",
  GYEONGGI_ANYANG: "안양시",
  GYEONGGI_BUCHEON: "부천시",
  GYEONGGI_GWANGMYEONG: "광명시",
  GYEONGGI_PYEONGTAEK: "평택시",
  GYEONGGI_DONGDUCHEON: "동두천시",
  GYEONGGI_ANSAN: "안산시",
  GYEONGGI_GOYANG: "고양시",
  GYEONGGI_GWACHEON: "과천시",
  GYEONGGI_GURI: "구리시",
  GYEONGGI_NAMYANGJU: "남양주시",
  GYEONGGI_OSAN: "오산시",
  GYEONGGI_SIHEUNG: "시흥시",
  GYEONGGI_GUNPO: "군포시",
  GYEONGGI_UIWANG: "의왕시",
  GYEONGGI_HANAM: "하남시",
  GYEONGGI_YONGIN: "용인시",
  GYEONGGI_PAJU: "파주시",
  GYEONGGI_ICHEON: "이천시",
  GYEONGGI_ANSEONG: "안성시",
  GYEONGGI_GIMPO: "김포시",
  GYEONGGI_HWASEONG: "화성시",
  GYEONGGI_GWANGJU: "광주시",
  GYEONGGI_YANGJU: "양주시",
  GYEONGGI_POCHEON: "포천시",
  GYEONGGI_YEOJU: "여주시",
  GYEONGGI_YEONCHEON: "연천군",
  GYEONGGI_GAPYEONG: "가평군",
  GYEONGGI_YANGPYEONG: "양평군",
};

/** 세부 지역을 두는 광역. 나머지 광역은 광역 하나가 곧 가장 작은 단위다. */
export const DISTRICT_REGIONS = ["SEOUL", "GYEONGGI"] as const satisfies readonly Region[];

/** 구·시·군이 속한 광역. 코드 앞부분이 광역 코드다. */
export function districtRegion(district: District): Region {
  return district.startsWith("SEOUL_") ? "SEOUL" : "GYEONGGI";
}

/** 그 광역의 구·시·군. 세부 지역이 없는 광역이면 빈 목록이다. */
export function districtsOf(region: string): District[] {
  return DISTRICTS.filter((d) => districtRegion(d) === region);
}

export function isDistrict(value: unknown): value is District {
  return typeof value === "string" && (DISTRICTS as readonly string[]).includes(value);
}

/**
 * 필터 권역. 이름은 사람들이 실제로 부르는 대표 동네다 — 칩 이름만 보고 어디인지 알 수
 * 있어야 한다. 이름에 없는 구·시는 `AREA_DISTRICTS` 로 칩 아래에 함께 보여준다.
 */
export const AREAS = [
  "SEOUL_GANGNAM_SEOCHO",
  "SEOUL_JAMSIL_GANGDONG",
  "SEOUL_SEONGSU_KONKUK",
  "SEOUL_NOWON_SEONGBUK",
  "SEOUL_GWANGHWAMUN_YONGSAN",
  "SEOUL_HONGDAE_SINCHON",
  "SEOUL_YEOUIDO_MOKDONG",
  "SEOUL_SADANG_SILLIM",
  "GYEONGGI_BUNDANG_YONGIN",
  "GYEONGGI_SUWON_DONGTAN",
  "GYEONGGI_HANAM_GWANGJU",
  "GYEONGGI_ANYANG_GWACHEON",
  "GYEONGGI_BUCHEON_GWANGMYEONG",
  "GYEONGGI_ILSAN_GIMPO",
  "GYEONGGI_UIJEONGBU_NAMYANGJU",
] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABELS: Record<Area, string> = {
  SEOUL_GANGNAM_SEOCHO: "강남·서초",
  SEOUL_JAMSIL_GANGDONG: "잠실·강동",
  SEOUL_SEONGSU_KONKUK: "성수·건대",
  SEOUL_NOWON_SEONGBUK: "노원·성북",
  SEOUL_GWANGHWAMUN_YONGSAN: "광화문·용산",
  SEOUL_HONGDAE_SINCHON: "홍대·신촌",
  SEOUL_YEOUIDO_MOKDONG: "여의도·목동",
  SEOUL_SADANG_SILLIM: "사당·신림",
  GYEONGGI_BUNDANG_YONGIN: "분당·용인",
  GYEONGGI_SUWON_DONGTAN: "수원·동탄",
  GYEONGGI_HANAM_GWANGJU: "하남·광주",
  GYEONGGI_ANYANG_GWACHEON: "안양·과천",
  GYEONGGI_BUCHEON_GWANGMYEONG: "부천·광명",
  GYEONGGI_ILSAN_GIMPO: "일산·김포",
  GYEONGGI_UIJEONGBU_NAMYANGJU: "의정부·남양주",
};

/** 권역 → 구·시·군. 서울·경기의 구·시·군은 정확히 한 권역에 든다(테스트가 지킨다). */
export const AREA_DISTRICTS: Record<Area, readonly District[]> = {
  SEOUL_GANGNAM_SEOCHO: ["SEOUL_GANGNAM", "SEOUL_SEOCHO"],
  SEOUL_JAMSIL_GANGDONG: ["SEOUL_SONGPA", "SEOUL_GANGDONG"],
  SEOUL_SEONGSU_KONKUK: ["SEOUL_SEONGDONG", "SEOUL_GWANGJIN", "SEOUL_DONGDAEMUN"],
  SEOUL_NOWON_SEONGBUK: [
    "SEOUL_SEONGBUK",
    "SEOUL_GANGBUK",
    "SEOUL_DOBONG",
    "SEOUL_NOWON",
    "SEOUL_JUNGNANG",
  ],
  SEOUL_GWANGHWAMUN_YONGSAN: ["SEOUL_JONGNO", "SEOUL_JUNG", "SEOUL_YONGSAN"],
  SEOUL_HONGDAE_SINCHON: ["SEOUL_MAPO", "SEOUL_SEODAEMUN", "SEOUL_EUNPYEONG"],
  SEOUL_YEOUIDO_MOKDONG: ["SEOUL_YEONGDEUNGPO", "SEOUL_YANGCHEON", "SEOUL_GANGSEO"],
  SEOUL_SADANG_SILLIM: ["SEOUL_DONGJAK", "SEOUL_GWANAK", "SEOUL_GURO", "SEOUL_GEUMCHEON"],
  GYEONGGI_BUNDANG_YONGIN: ["GYEONGGI_SEONGNAM", "GYEONGGI_YONGIN"],
  GYEONGGI_SUWON_DONGTAN: [
    "GYEONGGI_SUWON",
    "GYEONGGI_HWASEONG",
    "GYEONGGI_OSAN",
    "GYEONGGI_PYEONGTAEK",
    "GYEONGGI_ANSEONG",
  ],
  GYEONGGI_HANAM_GWANGJU: [
    "GYEONGGI_HANAM",
    "GYEONGGI_GWANGJU",
    "GYEONGGI_ICHEON",
    "GYEONGGI_YEOJU",
    "GYEONGGI_YANGPYEONG",
  ],
  GYEONGGI_ANYANG_GWACHEON: [
    "GYEONGGI_ANYANG",
    "GYEONGGI_GWACHEON",
    "GYEONGGI_UIWANG",
    "GYEONGGI_GUNPO",
  ],
  GYEONGGI_BUCHEON_GWANGMYEONG: [
    "GYEONGGI_BUCHEON",
    "GYEONGGI_GWANGMYEONG",
    "GYEONGGI_SIHEUNG",
    "GYEONGGI_ANSAN",
  ],
  GYEONGGI_ILSAN_GIMPO: ["GYEONGGI_GOYANG", "GYEONGGI_PAJU", "GYEONGGI_GIMPO"],
  GYEONGGI_UIJEONGBU_NAMYANGJU: [
    "GYEONGGI_UIJEONGBU",
    "GYEONGGI_NAMYANGJU",
    "GYEONGGI_GURI",
    "GYEONGGI_YANGJU",
    "GYEONGGI_DONGDUCHEON",
    "GYEONGGI_POCHEON",
    "GYEONGGI_YEONCHEON",
    "GYEONGGI_GAPYEONG",
  ],
};

/** 권역이 속한 광역. */
export function areaRegion(area: Area): Region {
  return area.startsWith("SEOUL_") ? "SEOUL" : "GYEONGGI";
}

/** 그 광역의 권역. 필터가 광역 칩을 펼쳤을 때 늘어놓는 순서다. */
export function areasOf(region: string): Area[] {
  return AREAS.filter((a) => areaRegion(a) === region);
}

/** 구·시·군이 든 권역. */
export function districtArea(district: District): Area {
  return AREAS.find((a) => AREA_DISTRICTS[a].includes(district))!;
}

/** 권역들 → 구·시·군 목록. 필터 SQL 이 이 목록으로 거른다. */
export function districtsOfAreas(areas: readonly Area[]): District[] {
  return areas.flatMap((a) => AREA_DISTRICTS[a]);
}

/**
 * 거주 광역과 세부 지역을 맞춘다. 저장 직전에 부른다.
 *  - 세부 지역만 있으면 광역을 거기서 정한다(「분당 거주」 → 경기).
 *  - 둘이 어긋나면 광역을 믿고 세부 지역을 버린다 — 사람이 고치는 칸은 광역 쪽이다.
 */
export function reconcileResidence(
  region: Region | null,
  district: District | null | undefined,
): { region: Region | null; district: District | null } {
  if (!district) return { region, district: null };
  const owner = districtRegion(district);
  if (region == null) return { region: owner, district };
  return region === owner ? { region, district } : { region, district: null };
}

/**
 * 원문에서 구·시·군을 찾는 낱말. 이름 그대로와, 구·시 이름 대신 흔히 쓰는 동네 이름이다.
 * 다른 낱말과 겹치는 이름(「고양이」「양주」「동작」「광주광역시」)은 행정 단위를 붙인 꼴만 쓴다.
 * 테스트용 mock 추출과 시드가 쓴다 — 운영 추출은 모델이 한다.
 */
export const DISTRICT_KEYWORDS: Record<District, readonly string[]> = {
  SEOUL_JONGNO: ["종로", "광화문", "혜화", "서촌", "북촌"],
  SEOUL_JUNG: ["서울 중구", "명동", "을지로", "충무로", "신당동"],
  SEOUL_YONGSAN: ["용산", "이태원", "한남동", "후암동"],
  SEOUL_SEONGDONG: ["성동구", "성수", "왕십리", "금호동", "옥수동"],
  SEOUL_GWANGJIN: ["광진", "건대", "자양동"],
  SEOUL_DONGDAEMUN: ["동대문", "회기", "청량리", "답십리", "장안동"],
  SEOUL_JUNGNANG: ["중랑", "상봉", "면목동"],
  SEOUL_SEONGBUK: ["성북", "길음", "안암", "돈암", "정릉"],
  SEOUL_GANGBUK: ["강북구", "미아동", "미아사거리", "수유동", "수유역"],
  SEOUL_DOBONG: ["도봉", "창동", "쌍문"],
  SEOUL_NOWON: ["노원", "상계동", "중계동", "공릉"],
  SEOUL_EUNPYEONG: ["은평", "불광", "연신내", "녹번", "응암"],
  SEOUL_SEODAEMUN: ["서대문", "신촌", "연희동", "홍제"],
  SEOUL_MAPO: ["마포", "홍대", "합정", "망원동", "상암", "공덕", "연남"],
  SEOUL_YANGCHEON: ["양천", "목동", "신정동", "신월동"],
  SEOUL_GANGSEO: ["강서구", "마곡", "화곡", "등촌", "가양동"],
  SEOUL_GURO: ["구로", "신도림"],
  SEOUL_GEUMCHEON: ["금천", "가산동", "가산디지털", "독산"],
  SEOUL_YEONGDEUNGPO: ["영등포", "여의도", "당산", "문래"],
  SEOUL_DONGJAK: ["동작구", "사당", "노량진", "흑석", "상도동"],
  SEOUL_GWANAK: ["관악구", "신림", "봉천", "서울대입구"],
  SEOUL_SEOCHO: ["서초", "반포", "방배", "양재", "잠원"],
  SEOUL_GANGNAM: ["강남", "역삼", "삼성동", "논현", "압구정", "청담", "대치동", "선릉", "도곡", "개포"],
  SEOUL_SONGPA: ["송파", "잠실", "문정동", "가락동", "위례", "방이동"],
  SEOUL_GANGDONG: ["강동구", "천호", "고덕", "명일동", "암사"],
  GYEONGGI_SUWON: ["수원", "광교", "영통"],
  GYEONGGI_SEONGNAM: ["성남", "분당", "판교", "정자동", "서현동", "야탑"],
  GYEONGGI_UIJEONGBU: ["의정부"],
  GYEONGGI_ANYANG: ["안양", "평촌", "범계"],
  GYEONGGI_BUCHEON: ["부천"],
  GYEONGGI_GWANGMYEONG: ["광명"],
  GYEONGGI_PYEONGTAEK: ["평택"],
  GYEONGGI_DONGDUCHEON: ["동두천"],
  GYEONGGI_ANSAN: ["안산"],
  GYEONGGI_GOYANG: ["고양시", "일산", "삼송", "화정동", "행신"],
  GYEONGGI_GWACHEON: ["과천"],
  GYEONGGI_GURI: ["구리시"],
  GYEONGGI_NAMYANGJU: ["남양주", "다산신도시", "별내"],
  GYEONGGI_OSAN: ["오산"],
  GYEONGGI_SIHEUNG: ["시흥시", "배곧"],
  GYEONGGI_GUNPO: ["군포", "산본"],
  GYEONGGI_UIWANG: ["의왕"],
  GYEONGGI_HANAM: ["하남", "미사동", "미사강변"],
  GYEONGGI_YONGIN: ["용인", "기흥", "죽전"],
  GYEONGGI_PAJU: ["파주", "운정신도시"],
  GYEONGGI_ICHEON: ["이천시"],
  GYEONGGI_ANSEONG: ["안성시"],
  GYEONGGI_GIMPO: ["김포"],
  GYEONGGI_HWASEONG: ["화성시", "동탄"],
  GYEONGGI_GWANGJU: ["경기 광주", "경기도 광주", "오포"],
  GYEONGGI_YANGJU: ["양주시"],
  GYEONGGI_POCHEON: ["포천"],
  GYEONGGI_YEOJU: ["여주시"],
  GYEONGGI_YEONCHEON: ["연천"],
  GYEONGGI_GAPYEONG: ["가평"],
  GYEONGGI_YANGPYEONG: ["양평"],
};

/**
 * 글에서 처음 나오는 구·시·군. 위치가 가장 앞선 낱말을 고른다 — 「강남 직장, 분당 거주」
 * 처럼 여러 곳이 나오면 부르는 쪽이 거주 줄만 잘라 넘긴다.
 */
export function matchDistrict(text: string): District | null {
  let best: { district: District; at: number } | null = null;
  for (const district of DISTRICTS) {
    for (const keyword of DISTRICT_KEYWORDS[district]) {
      const at = text.indexOf(keyword);
      if (at >= 0 && (best == null || at < best.at)) best = { district, at };
    }
  }
  return best?.district ?? null;
}

/** `reconcileResidence` 를 필드 묶음에 건다. 추출 결과와 검토값을 저장·등록하기 전에 쓴다. */
export function reconcileResidenceFields<
  T extends { residenceRegion: Region | null; residenceDistrict?: District | null },
>(fields: T): T {
  const { region, district } = reconcileResidence(fields.residenceRegion, fields.residenceDistrict);
  return { ...fields, residenceRegion: region, residenceDistrict: district };
}

export function isArea(value: unknown): value is Area {
  return typeof value === "string" && (AREAS as readonly string[]).includes(value);
}
