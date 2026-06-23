"""매칭 점수 로직. 프론트엔드(BolsaramApp.jsx)의 규칙 기반 점수를 서버 단일 소스로 이전한 모듈.

후보 입력은 serialize_candidate가 만드는 camelCase dict를 기준으로 한다.
지역/직업 분류 사전은 방마다 조정할 수 있도록 모듈 상단 상수로 분리한다.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

JOB_GROUPS: list[tuple[str, str]] = [
    ("금융", r"은행|금융|보험|증권"),
    ("대기업", r"현대|삼성|lg|sk|자동차|대기업"),
    ("공무원", r"공무원|공공"),
    ("IT", r"it|개발|기획|서비스|테크"),
    ("전문직", r"변호사|의사|회계사|전문직|로펌"),
]

REGION_GROUPS: list[list[str]] = [
    ["강남", "삼성", "판교", "분당", "야탑"],
    ["김포", "마포", "공항", "서울"],
]

STABLE_JOB_GROUPS = {"금융", "대기업", "전문직", "공무원"}


def normalize(value: Any) -> str:
    return re.sub(r"\s", "", str(value or "")).lower()


def split_words(value: Any) -> list[str]:
    return [word for word in re.split(r"[,\s/·]+", str(value or "")) if word.strip()]


def age(candidate: dict[str, Any], current_year: int | None = None) -> int:
    year = current_year if current_year is not None else datetime.now().year
    return year - int(candidate.get("birthYear") or 0)


def job_group(job: Any) -> str:
    text = normalize(job)
    for label, pattern in JOB_GROUPS:
        if re.search(pattern, text):
            return label
    return "기타"


def close_region(a: Any, b: Any) -> bool:
    one = normalize(a)
    two = normalize(b)
    return any(
        any(word in one for word in group) and any(word in two for word in group)
        for group in REGION_GROUPS
    )


def match_score(a: dict[str, Any], b: dict[str, Any], current_year: int | None = None) -> dict[str, Any]:
    score = 0
    reasons: list[str] = []
    age_diff = abs(age(a, current_year) - age(b, current_year))
    a_hobbies = split_words(a.get("hobbies"))
    b_hobbies = split_words(b.get("hobbies"))
    shared_hobbies = [hobby for hobby in a_hobbies if hobby in b_hobbies]
    same_religion = a.get("religion") == b.get("religion") or a.get("religion") == "미입력" or b.get("religion") == "미입력"
    smoke_ok = a.get("smoke") == b.get("smoke") or a.get("smoke") == "미입력" or b.get("smoke") == "미입력"
    b_personality = normalize(b.get("personality"))
    ideal_hit = any(normalize(word) in b_personality for word in split_words(a.get("ideal")))

    if age_diff <= 4:
        score += 20
        reasons.append("나이 차이 적절")
    elif age_diff <= 7:
        score += 12
        reasons.append("나이 조건 검토 가능")
    if close_region(a.get("location"), b.get("location")):
        score += 15
        reasons.append("생활권 가까움")
    if same_religion:
        score += 15
        reasons.append("종교 조건 충족")
    if smoke_ok:
        score += 15
        reasons.append("흡연 조건 충족")
    if shared_hobbies:
        score += min(10, len(shared_hobbies) * 5)
        reasons.append(f"공통 취미 {', '.join(shared_hobbies[:2])}")
    a_mbti = str(a.get("mbti") or "")
    b_mbti = str(b.get("mbti") or "")
    if a_mbti and b_mbti and a_mbti[0] != b_mbti[0]:
        score += 8
        reasons.append("성향 밸런스")
    if ideal_hit:
        score += 10
        reasons.append("이상형 키워드 일부 일치")
    if job_group(b.get("job")) in STABLE_JOB_GROUPS:
        score += 5
        reasons.append("직업 안정성")

    return {"score": min(score, 100), "reasons": reasons[:4]}
