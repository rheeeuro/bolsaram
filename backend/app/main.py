from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

import pymysql
from fastapi import Cookie, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, EmailStr, Field


BASE_DIR = Path(__file__).resolve().parents[2]
SCHEMA_SQL_PATH = BASE_DIR / "sql" / "schema.sql"
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
WATERMARK_FONT_PATH = os.getenv("WATERMARK_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
# 카카오 챗봇 스킬 서버가 사진 업로드 API 호출 시 보내야 하는 공용 키. 비어 있으면 카카오 업로드를 막는다.
KAKAO_API_KEY = os.getenv("KAKAO_API_KEY", "")
# 후보별 업로드 코드의 유효 시간(분)과 코드 1건당 허용 업로드 횟수.
UPLOAD_CODE_TTL_MINUTES = int(os.getenv("UPLOAD_CODE_TTL_MINUTES", "30"))
UPLOAD_CODE_MAX_USES = int(os.getenv("UPLOAD_CODE_MAX_USES", "10"))
UPLOAD_TOKEN_TTL_MINUTES = int(os.getenv("UPLOAD_TOKEN_TTL_MINUTES", "30"))
KAKAO_DEFAULT_ROOM_ID = os.getenv("KAKAO_DEFAULT_ROOM_ID", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", os.getenv("FRONTEND_PUBLIC_URL", "http://127.0.0.1:3020")).rstrip("/")

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3308")),
    "user": os.getenv("DB_USER", "bolsaram_user"),
    "password": os.getenv("DB_PASSWORD", "bolsaram0711"),
    "database": os.getenv("DB_NAME", "bolsaram"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True,
}

SESSION_COOKIE = "bolsaram_session"
SESSION_MAX_AGE = 14 * 24 * 60 * 60
ROOM_ID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
ROOM_ID_ALPHABET = f"{ROOM_ID_LETTERS}23456789"
STATUSES = ["등록됨", "비활성"]
PLAN_LIMITS = {
    "free": {"rooms": 1, "candidates": 30},
    "pro": {"rooms": 5, "candidates": 300},
    "group": {"rooms": 20, "candidates": 1000},
}
WRITE_ROLES = {"owner", "admin", "member"}
ASSIGNABLE_ROLES = {"admin", "member", "viewer"}


def plan_limits(plan: str | None) -> dict[str, int]:
    return PLAN_LIMITS.get(plan or "free", PLAN_LIMITS["free"])

SAMPLE_CANDIDATES = [
    {
        "alias": "95년생 여성 A",
        "gender": "여",
        "birthYear": 1995,
        "height": 163,
        "location": "김포공항역 인근",
        "job": "현대자동차 7년차",
        "education": "연세대 학부졸",
        "religion": "무교",
        "smoke": "비흡연",
        "drink": "가끔",
        "mbti": "ESFJ",
        "personality": "외향적, 긍정적",
        "hobbies": "헬스, 수영, 러닝",
        "ideal": "배려심 있고 선한 사람",
        "memo": "활동적이고 대화가 밝은 스타일",
        "privacy": "그룹 내 공개",
        "status": "등록됨",
        "color": "#2f7d69",
    },
    {
        "alias": "92년생 남성 B",
        "gender": "남",
        "birthYear": 1992,
        "height": 178,
        "location": "삼성동",
        "job": "우리은행 본점",
        "education": "성균관대",
        "religion": "무교",
        "smoke": "비흡연",
        "drink": "가끔",
        "mbti": "ISTJ",
        "personality": "차분함, 책임감",
        "hobbies": "러닝, 와인, 독서",
        "ideal": "밝고 자기 일이 있는 사람",
        "memo": "안정적인 직장 선호 조건에 잘 맞음",
        "privacy": "그룹 내 공개",
        "status": "등록됨",
        "color": "#386fa4",
    },
    {
        "alias": "89년생 남성 C",
        "gender": "남",
        "birthYear": 1989,
        "height": 181,
        "location": "분당 야탑",
        "job": "외국계 보험사",
        "education": "중앙대",
        "religion": "기독교",
        "smoke": "비흡연",
        "drink": "안함",
        "mbti": "ENFJ",
        "personality": "다정함, 리드형",
        "hobbies": "등산, 헬스, 맛집",
        "ideal": "가치관이 선하고 대화가 잘 되는 사람",
        "memo": "종교 조건 확인 필요",
        "privacy": "전체 공개",
        "status": "등록됨",
        "color": "#a87620",
    },
    {
        "alias": "94년생 여성 D",
        "gender": "여",
        "birthYear": 1994,
        "height": 160,
        "location": "판교",
        "job": "IT 서비스 기획자",
        "education": "한양대",
        "religion": "무교",
        "smoke": "비흡연",
        "drink": "가끔",
        "mbti": "INFJ",
        "personality": "신중함, 배려심",
        "hobbies": "필라테스, 전시, 산책",
        "ideal": "예의 있고 안정적인 사람",
        "memo": "진지한 만남 선호",
        "privacy": "그룹 내 공개",
        "status": "등록됨",
        "color": "#c7604d",
    },
]

app = FastAPI(title="bolsaram API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3020,http://127.0.0.1:3020").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


class SignupPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=255)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=255)


class RoomPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    visibility: str = "public"


class JoinPayload(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class PublicRoomJoinPayload(BaseModel):
    roomId: str = Field(min_length=1, max_length=32)


class CandidatePayload(BaseModel):
    alias: str = Field(min_length=1, max_length=120)
    gender: str = "여"
    birthYear: int = Field(ge=1970, le=2100)
    height: int | None = Field(default=None, ge=100, le=250)
    location: str = ""
    job: str = ""
    education: str = ""
    religion: str = "미입력"
    smoke: str = "미입력"
    drink: str = "미입력"
    mbti: str = ""
    personality: str = ""
    hobbies: str = ""
    ideal: str = ""
    memo: str = ""
    privacy: str = "그룹 내 공개"
    status: str = "등록됨"
    color: str | None = None
    consent: bool = False
    contact: str = ""


class StatusPayload(BaseModel):
    status: str


class RolePayload(BaseModel):
    role: str


@contextmanager
def db():
    connection = pymysql.connect(**DB_CONFIG)
    try:
        yield connection
    finally:
        connection.close()


def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with db() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()


def fetch_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with db() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())


def execute(sql: str, params: tuple[Any, ...] = ()) -> int:
    with db() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return int(cursor.lastrowid or 0)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f"{base64.urlsafe_b64encode(salt).decode()}:{base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_text, digest_text = stored.split(":", 1)
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(digest_text.encode())
        actual = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def iso(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return datetime.fromisoformat(str(value)).isoformat()


def today_label() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def date_label(value: Any) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value).replace(".", "-")


def random_color() -> str:
    return secrets.choice(["#2f7d69", "#386fa4", "#c7604d", "#a87620", "#5c6f45", "#7c4d8b"])


def random_invite_code() -> str:
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:8].upper()


def random_room_public_id() -> str:
    return secrets.choice(ROOM_ID_LETTERS) + "".join(secrets.choice(ROOM_ID_ALPHABET) for _ in range(6))


def unique_room_public_id() -> str:
    for _ in range(16):
        public_id = random_room_public_id()
        if not fetch_one("SELECT id FROM rooms WHERE public_id = %s LIMIT 1", (public_id,)):
            return public_id
    raise HTTPException(status_code=500, detail="방 아이디를 생성하지 못했습니다.")


def unique_invite_code() -> str:
    for _ in range(8):
        code = random_invite_code()
        if not fetch_one("SELECT id FROM rooms WHERE invite_code = %s LIMIT 1", (code,)):
            return code
    raise HTTPException(status_code=500, detail="초대 코드를 생성하지 못했습니다.")


def random_upload_code() -> str:
    return "".join(secrets.choice(ROOM_ID_ALPHABET) for _ in range(8))


def unique_upload_code() -> str:
    for _ in range(16):
        code = random_upload_code()
        if not fetch_one("SELECT id FROM candidate_upload_codes WHERE code = %s LIMIT 1", (code,)):
            return code
    raise HTTPException(status_code=500, detail="업로드 코드를 생성하지 못했습니다.")


def unique_upload_token() -> str:
    for _ in range(16):
        token = secrets.token_urlsafe(32)
        if not fetch_one("SELECT id FROM upload_tokens WHERE token_hash = %s LIMIT 1", (hash_token(token),)):
            return token
    raise HTTPException(status_code=500, detail="업로드 링크를 생성하지 못했습니다.")


def app_base_url(request: Request | None = None) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    if request:
        return str(request.base_url).rstrip("/")
    return ""


def nested_value(data: dict[str, Any], *keys: str) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def kakao_params(payload: dict[str, Any]) -> dict[str, Any]:
    params = nested_value(payload, "action", "params")
    return params if isinstance(params, dict) else {}


def kakao_user_key(payload: dict[str, Any]) -> str:
    properties = nested_value(payload, "userRequest", "user", "properties") or {}
    candidates = (
        nested_value(payload, "userRequest", "user", "id"),
        properties.get("plusfriendUserKey") if isinstance(properties, dict) else None,
        properties.get("appUserId") if isinstance(properties, dict) else None,
        properties.get("botUserKey") if isinstance(properties, dict) else None,
    )
    for item in candidates:
        if item:
            return str(item)[:120]
    return "unknown"


def resolve_kakao_upload_room(payload: dict[str, Any]) -> int | None:
    params = kakao_params(payload)
    room_ref = params.get("roomId") or params.get("room_id") or KAKAO_DEFAULT_ROOM_ID
    return resolve_room_db_id(room_ref) if room_ref else None


def issue_upload_token(db_room_id: int, kakao_key: str) -> tuple[str, datetime]:
    token = unique_upload_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=UPLOAD_TOKEN_TTL_MINUTES)
    execute(
        """
        INSERT INTO upload_tokens (room_id, token_hash, kakao_user_key, purpose, expires_at)
        VALUES (%s, %s, %s, 'profile_upload', %s)
        """,
        (db_room_id, hash_token(token), kakao_key[:120], expires_at.strftime("%Y-%m-%d %H:%M:%S")),
    )
    return token, expires_at


def upload_token_or_error(token: str) -> dict[str, Any]:
    row = fetch_one(
        """
        SELECT ut.*, r.name AS room_name, r.public_id AS room_public_id,
               (ut.expires_at <= UTC_TIMESTAMP()) AS expired
          FROM upload_tokens ut
          JOIN rooms r ON r.id = ut.room_id
         WHERE ut.token_hash = %s
         LIMIT 1
        """,
        (hash_token(token.strip()),),
    )
    if not row:
        raise HTTPException(status_code=404, detail="유효하지 않은 업로드 링크입니다.")
    if row.get("used_at"):
        raise HTTPException(status_code=409, detail="이미 사용된 업로드 링크입니다.")
    if row.get("expired"):
        raise HTTPException(status_code=410, detail="업로드 링크가 만료되었습니다.")
    return row


def kakao_skill_response(text: str, upload_url: str | None = None) -> dict[str, Any]:
    template: dict[str, Any] = {"outputs": [{"simpleText": {"text": text}}]}
    if upload_url:
        template["quickReplies"] = [{"label": "업로드하기", "action": "webLink", "webLinkUrl": upload_url}]
    return {"version": "2.0", "template": template}


def require_kakao_api_key(x_kakao_api_key: str | None) -> None:
    if KAKAO_API_KEY and (not x_kakao_api_key or not hmac.compare_digest(x_kakao_api_key, KAKAO_API_KEY)):
        raise HTTPException(status_code=401, detail="인증에 실패했습니다.")


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    plan = user.get("plan") or "free"
    return {"id": str(user["id"]), "name": user["name"], "email": user["email"], "plan": plan, "limits": plan_limits(plan)}


def serialize_room(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["public_id"],
        "ownerId": str(row["owner_id"]),
        "name": row["name"],
        "visibility": row["visibility"],
        "inviteCode": row.get("invite_code"),
        "inviteUrl": f"/join/{row['invite_code']}" if row.get("invite_code") else None,
        "isMember": bool(row.get("is_member")),
        "role": row.get("role"),
        "memberCount": int(row.get("member_count") or 0),
        "candidateCount": int(row.get("candidate_count") or 0),
        "createdAt": iso(row["created_at"]),
    }


def serialize_photo(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "imageUrl": row["image_url"],
        "sortOrder": int(row["sort_order"]),
        "isPrimary": bool(row["is_primary"]),
    }


def serialize_candidate(row: dict[str, Any], photos: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "roomId": str(row["room_id"]),
        "alias": row["alias"],
        "gender": row["gender"],
        "birthYear": int(row["birth_year"]),
        "height": int(row["height"]) if row.get("height") is not None else None,
        "location": row["location"],
        "job": row["job"],
        "education": row["education"],
        "religion": row["religion"],
        "smoke": row["smoke"],
        "drink": row["drink"],
        "mbti": row["mbti"],
        "personality": row["personality"],
        "hobbies": row["hobbies"],
        "ideal": row["ideal"],
        "memo": row.get("memo") or "",
        "privacy": row["privacy"],
        "status": row["status"],
        "color": row["color"],
        "consent": bool(row.get("consent_checked")),
        "contact": row.get("contact") or "",
        "photos": [serialize_photo(photo) for photo in (photos or [])],
        "createdAt": iso(row["created_at"]),
        "updatedAt": iso(row["updated_at"]) if row.get("updated_at") else None,
    }


def fetch_candidate_photos(candidate_id: int | str) -> list[dict[str, Any]]:
    return fetch_all(
        "SELECT * FROM candidate_photos WHERE candidate_id = %s ORDER BY is_primary DESC, sort_order, id",
        (candidate_id,),
    )


def candidate_with_photos(row: dict[str, Any]) -> dict[str, Any]:
    return serialize_candidate(row, fetch_candidate_photos(row["id"]))


def serialize_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = [row["id"] for row in rows]
    photos_by_candidate: dict[Any, list[dict[str, Any]]] = {}
    if ids:
        placeholders = ", ".join(["%s"] * len(ids))
        photos = fetch_all(
            f"SELECT * FROM candidate_photos WHERE candidate_id IN ({placeholders}) ORDER BY is_primary DESC, sort_order, id",
            tuple(ids),
        )
        for photo in photos:
            photos_by_candidate.setdefault(photo["candidate_id"], []).append(photo)
    return [serialize_candidate(row, photos_by_candidate.get(row["id"], [])) for row in rows]


def serialize_log(row: dict[str, Any]) -> dict[str, Any]:
    pair = [str(row["candidate_id"])]
    if row.get("other_candidate_id"):
        pair.append(str(row["other_candidate_id"]))
    return {
        "id": str(row["id"]),
        "roomId": str(row["room_id"]),
        "pair": pair,
        "status": row["status"],
        "date": date_label(row["log_date"]),
        "memo": row["memo"],
        "createdAt": iso(row["created_at"]),
    }


def normalize_candidate(payload: CandidatePayload | dict[str, Any]) -> dict[str, Any]:
    data = payload.model_dump() if isinstance(payload, CandidatePayload) else dict(payload)
    status = data.get("status") if data.get("status") in STATUSES else "등록됨"
    color = data.get("color") if isinstance(data.get("color"), str) and data.get("color", "").startswith("#") else random_color()
    return {
        "alias": str(data.get("alias", "")).strip()[:120],
        "gender": "남" if data.get("gender") == "남" else "여",
        "birth_year": int(data.get("birthYear") or data.get("birth_year")),
        "height": data.get("height") or None,
        "location": str(data.get("location", "")).strip()[:160],
        "job": str(data.get("job", "")).strip()[:180],
        "education": str(data.get("education", "")).strip()[:180],
        "religion": str(data.get("religion", "미입력"))[:40],
        "smoke": str(data.get("smoke", "미입력"))[:40],
        "drink": str(data.get("drink", "미입력"))[:40],
        "mbti": str(data.get("mbti", "")).strip().upper()[:12],
        "personality": str(data.get("personality", "")).strip()[:255],
        "hobbies": str(data.get("hobbies", "")).strip()[:255],
        "ideal": str(data.get("ideal", "")).strip()[:255],
        "memo": str(data.get("memo", "")).strip()[:3000],
        "privacy": str(data.get("privacy", "그룹 내 공개"))[:40],
        "status": status,
        "color": color[:7],
        "consent_checked": 1 if data.get("consent") or data.get("consent_checked") else 0,
        "contact": str(data.get("contact", "")).strip()[:120],
    }


CANDIDATE_COLUMNS = (
    "alias", "gender", "birth_year", "height", "location", "job", "education",
    "religion", "smoke", "drink", "mbti", "personality", "hobbies", "ideal",
    "memo", "privacy", "status", "color", "consent_checked", "contact",
)


def candidate_values(candidate: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(candidate[column] for column in CANDIDATE_COLUMNS)


def current_user(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return fetch_one(
        """
        SELECT u.id, u.name, u.email, u.plan
          FROM sessions s
          JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = %s AND s.expires_at > UTC_TIMESTAMP()
         LIMIT 1
        """,
        (hash_token(token),),
    )


def require_user(token: str | None) -> dict[str, Any]:
    user = current_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user


def get_room(room_id: int | str, user_id: int | str) -> dict[str, Any] | None:
    db_room_id = resolve_room_db_id(room_id)
    if not db_room_id:
        return None
    row = fetch_one(
        """
        SELECT r.id, r.public_id, r.owner_id, r.name, r.visibility, r.invite_code, r.created_at, rm.role,
               CASE WHEN rm.user_id IS NULL THEN 0 ELSE 1 END AS is_member,
               (SELECT COUNT(*) FROM room_members count_rm WHERE count_rm.room_id = r.id) AS member_count,
               (SELECT COUNT(*) FROM candidates count_c WHERE count_c.room_id = r.id) AS candidate_count
          FROM rooms r
          LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = %s
         WHERE r.id = %s
         LIMIT 1
        """,
        (user_id, db_room_id),
    )
    return serialize_room(row) if row else None


def resolve_room_db_id(room_ref: int | str) -> int | None:
    room_text = str(room_ref).strip().upper()
    row = fetch_one("SELECT id FROM rooms WHERE public_id = %s LIMIT 1", (room_text,))
    if row:
        return int(row["id"])
    if room_text.isdigit():
        row = fetch_one("SELECT id FROM rooms WHERE id = %s LIMIT 1", (room_text,))
        if row:
            return int(row["id"])
    return None


def get_accessible_room(room_id: int | str, user_id: int | str) -> dict[str, Any]:
    room = get_room(room_id, user_id)
    if not room or not room["isMember"]:
        raise HTTPException(status_code=403, detail="입장 권한이 없는 방입니다.")
    return room


def require_room_write(room: dict[str, Any]) -> None:
    if room.get("role") not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="읽기 전용(viewer) 권한으로는 수정할 수 없습니다.")


def get_accessible_room_id(room_id: int | str, user_id: int | str) -> tuple[int, dict[str, Any]]:
    db_room_id = resolve_room_db_id(room_id)
    if not db_room_id:
        raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")
    room = get_room(db_room_id, user_id)
    if not room or not room["isMember"]:
        raise HTTPException(status_code=403, detail="입장 권한이 없는 방입니다.")
    return db_room_id, room


def create_session(response: Response, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=SESSION_MAX_AGE)
    execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (hash_token(token), user_id, expires_at.strftime("%Y-%m-%d %H:%M:%S")),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=False,
    )


def load_schema_statements() -> list[str]:
    sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
    return [statement.strip() for statement in sql.split(";") if statement.strip()]


def ensure_schema() -> None:
    with db() as connection:
        with connection.cursor() as cursor:
            for statement in load_schema_statements():
                cursor.execute(statement)
            cursor.execute("SHOW COLUMNS FROM rooms LIKE 'public_id'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE rooms ADD COLUMN public_id CHAR(7) NULL AFTER id")
            for column, ddl in (
                ("consent_checked", "ADD COLUMN consent_checked TINYINT(1) NOT NULL DEFAULT 0 AFTER color"),
                ("contact", "ADD COLUMN contact VARCHAR(120) NOT NULL DEFAULT '' AFTER consent_checked"),
                ("updated_at", "ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
            ):
                cursor.execute("SHOW COLUMNS FROM candidates LIKE %s", (column,))
                if not cursor.fetchone():
                    cursor.execute(f"ALTER TABLE candidates {ddl}")
            cursor.execute("SHOW COLUMNS FROM match_logs LIKE 'log_date'")
            log_date_column = cursor.fetchone()
            if log_date_column and str(log_date_column.get("Type", "")).lower().startswith("varchar"):
                cursor.execute("UPDATE match_logs SET log_date = REPLACE(log_date, '.', '-')")
                cursor.execute("ALTER TABLE match_logs MODIFY log_date DATE NOT NULL")
            cursor.execute("UPDATE candidates SET status = '등록됨' WHERE status NOT IN ('등록됨', '비활성')")
            cursor.execute("SHOW COLUMNS FROM users LIKE 'plan'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE users ADD COLUMN plan VARCHAR(16) NOT NULL DEFAULT 'free'")
            cursor.execute("ALTER TABLE room_members MODIFY role ENUM('owner', 'admin', 'member', 'viewer') NOT NULL DEFAULT 'member'")
    backfill_room_public_ids()


def backfill_room_public_ids() -> None:
    rows = fetch_all("SELECT id FROM rooms WHERE public_id IS NULL OR public_id = '' ORDER BY id")
    for row in rows:
        execute("UPDATE rooms SET public_id = %s WHERE id = %s", (unique_room_public_id(), row["id"]))
    with db() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SHOW INDEX FROM rooms WHERE Column_name = 'public_id' AND Non_unique = 0")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE rooms ADD UNIQUE KEY rooms_public_id_unique (public_id)")
            cursor.execute("ALTER TABLE rooms MODIFY public_id CHAR(7) NOT NULL")


@app.on_event("startup")
def on_startup() -> None:
    ensure_schema()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me")
def me(bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = current_user(bolsaram_session)
    return {"user": public_user(user) if user else None}


@app.post("/api/auth/signup", status_code=201)
def signup(payload: SignupPayload, response: Response) -> dict[str, Any]:
    email = payload.email.lower()
    password_hash = hash_password(payload.password)
    with db() as connection:
        try:
            connection.begin()
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s)",
                    (payload.name.strip(), email, password_hash),
                )
                user_id = int(cursor.lastrowid)
            connection.commit()
        except pymysql.err.IntegrityError as exc:
            connection.rollback()
            raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다.") from exc
        except Exception:
            connection.rollback()
            raise
    create_session(response, user_id)
    return {"user": {"id": str(user_id), "name": payload.name.strip(), "email": email}}


@app.post("/api/auth/login")
def login(payload: LoginPayload, response: Response) -> dict[str, Any]:
    user = fetch_one("SELECT id, name, email, password_hash FROM users WHERE email = %s LIMIT 1", (payload.email.lower(),))
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    create_session(response, int(user["id"]))
    return {"user": public_user(user)}


@app.post("/api/auth/logout")
def logout(response: Response, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, bool]:
    if bolsaram_session:
        execute("DELETE FROM sessions WHERE token_hash = %s", (hash_token(bolsaram_session),))
    response.delete_cookie(SESSION_COOKIE, samesite="lax")
    return {"ok": True}


@app.get("/api/rooms")
def rooms(bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    rows = fetch_all(
        """
        SELECT r.id, r.public_id, r.owner_id, r.name, r.visibility, r.invite_code, r.created_at, rm.role,
               1 AS is_member,
               (SELECT COUNT(*) FROM room_members count_rm WHERE count_rm.room_id = r.id) AS member_count,
               (SELECT COUNT(*) FROM candidates count_c WHERE count_c.room_id = r.id) AS candidate_count
          FROM rooms r
          JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = %s
         ORDER BY rm.created_at DESC, r.created_at DESC
        """,
        (user["id"],),
    )
    return {"rooms": [serialize_room(row) for row in rows]}


@app.get("/api/rooms/public")
def public_rooms(bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    rows = fetch_all(
        """
        SELECT r.id, r.public_id, r.owner_id, r.name, r.visibility, r.invite_code, r.created_at, rm.role,
               CASE WHEN rm.user_id IS NULL THEN 0 ELSE 1 END AS is_member,
               (SELECT COUNT(*) FROM room_members count_rm WHERE count_rm.room_id = r.id) AS member_count,
               (SELECT COUNT(*) FROM candidates count_c WHERE count_c.room_id = r.id) AS candidate_count
          FROM rooms r
          LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = %s
         WHERE r.visibility = 'public'
         ORDER BY rm.user_id IS NULL DESC, r.created_at DESC
        """,
        (user["id"],),
    )
    return {"rooms": [serialize_room(row) for row in rows]}


@app.post("/api/rooms", status_code=201)
def create_room(payload: RoomPayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    owned = int(fetch_one("SELECT COUNT(*) AS c FROM rooms WHERE owner_id = %s", (user["id"],))["c"])
    room_limit = plan_limits(user.get("plan"))["rooms"]
    if owned >= room_limit:
        raise HTTPException(status_code=403, detail=f"현재 플랜에서는 방을 최대 {room_limit}개까지 만들 수 있습니다.")
    visibility = "private" if payload.visibility == "private" else "public"
    invite_code = unique_invite_code() if visibility == "private" else None
    room_id = execute(
        "INSERT INTO rooms (public_id, owner_id, name, visibility, invite_code) VALUES (%s, %s, %s, %s, %s)",
        (unique_room_public_id(), user["id"], payload.name.strip(), visibility, invite_code),
    )
    execute("INSERT INTO room_members (room_id, user_id, role) VALUES (%s, %s, 'owner')", (room_id, user["id"]))
    return {"room": get_room(room_id, user["id"])}


@app.post("/api/rooms/join")
def join_room(payload: JoinPayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    code = payload.code.strip().upper()
    room = fetch_one("SELECT id FROM rooms WHERE invite_code = %s AND visibility = 'private' LIMIT 1", (code,))
    if not room:
        raise HTTPException(status_code=404, detail="유효한 비공개방 코드가 아닙니다.")
    execute("INSERT IGNORE INTO room_members (room_id, user_id, role) VALUES (%s, %s, 'member')", (room["id"], user["id"]))
    return {"room": get_room(room["id"], user["id"])}


@app.post("/api/rooms/join-public")
def join_public_room(payload: PublicRoomJoinPayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id = resolve_room_db_id(payload.roomId)
    room = fetch_one("SELECT id FROM rooms WHERE id = %s AND visibility = 'public' LIMIT 1", (db_room_id,)) if db_room_id else None
    if not room:
        raise HTTPException(status_code=404, detail="입장 가능한 공개방이 아닙니다.")
    execute("INSERT IGNORE INTO room_members (room_id, user_id, role) VALUES (%s, %s, 'member')", (room["id"], user["id"]))
    return {"room": get_room(room["id"], user["id"])}


@app.get("/api/rooms/{room_id}/state")
def room_state(room_id: str, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, room = get_accessible_room_id(room_id, user["id"])
    candidates = fetch_all("SELECT * FROM candidates WHERE room_id = %s ORDER BY created_at DESC", (db_room_id,))
    logs = fetch_all("SELECT * FROM match_logs WHERE room_id = %s AND other_candidate_id IS NULL ORDER BY created_at DESC", (db_room_id,))
    return {
        "room": room,
        "candidates": serialize_candidates(candidates),
        "logs": [serialize_log(row) for row in logs],
    }


@app.post("/api/rooms/{room_id}/regenerate-code")
def regenerate_code(room_id: str, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    room = get_room(room_id, user["id"])
    if not room or room["role"] != "owner" or room["visibility"] != "private":
        raise HTTPException(status_code=403, detail="비공개방 소유자만 코드를 재발급할 수 있습니다.")
    code = unique_invite_code()
    db_room_id = resolve_room_db_id(room_id)
    execute("UPDATE rooms SET invite_code = %s WHERE id = %s", (code, db_room_id))
    return {"room": get_room(room_id, user["id"])}


def room_members(db_room_id: int) -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT u.id, u.name, u.email, rm.role
          FROM room_members rm
          JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = %s
         ORDER BY rm.role = 'owner' DESC, rm.created_at
        """,
        (db_room_id,),
    )
    return [{"id": str(row["id"]), "name": row["name"], "email": row["email"], "role": row["role"]} for row in rows]


@app.get("/api/rooms/{room_id}/members")
def list_members(room_id: str, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, room = get_accessible_room_id(room_id, user["id"])
    return {"members": room_members(db_room_id), "role": room["role"]}


@app.patch("/api/rooms/{room_id}/members/{member_id}")
def update_member_role(room_id: str, member_id: int, payload: RolePayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, room = get_accessible_room_id(room_id, user["id"])
    if room["role"] != "owner":
        raise HTTPException(status_code=403, detail="방 소유자만 역할을 변경할 수 있습니다.")
    if payload.role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail="지정할 수 없는 역할입니다.")
    target = fetch_one("SELECT role FROM room_members WHERE room_id = %s AND user_id = %s", (db_room_id, member_id))
    if not target:
        raise HTTPException(status_code=404, detail="해당 멤버를 찾을 수 없습니다.")
    if target["role"] == "owner":
        raise HTTPException(status_code=400, detail="소유자 역할은 변경할 수 없습니다.")
    execute("UPDATE room_members SET role = %s WHERE room_id = %s AND user_id = %s", (payload.role, db_room_id, member_id))
    return {"members": room_members(db_room_id), "role": room["role"]}


@app.post("/api/rooms/{room_id}/candidates", status_code=201)
def create_candidate(room_id: str, payload: CandidatePayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, room = get_accessible_room_id(room_id, user["id"])
    require_room_write(room)
    owner_plan = fetch_one("SELECT u.plan FROM rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = %s", (db_room_id,))
    candidate_limit = plan_limits(owner_plan["plan"] if owner_plan else "free")["candidates"]
    current_count = int(fetch_one("SELECT COUNT(*) AS c FROM candidates WHERE room_id = %s", (db_room_id,))["c"])
    if current_count >= candidate_limit:
        raise HTTPException(status_code=403, detail=f"이 방은 후보를 최대 {candidate_limit}명까지 등록할 수 있습니다. (방 소유자 플랜 기준)")
    candidate = normalize_candidate(payload)
    columns = ", ".join(("room_id", *CANDIDATE_COLUMNS))
    placeholders = ", ".join(["%s"] * (len(CANDIDATE_COLUMNS) + 1))
    candidate_id = execute(
        f"INSERT INTO candidates ({columns}) VALUES ({placeholders})",
        (db_room_id, *candidate_values(candidate)),
    )
    row = fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
    return {"candidate": candidate_with_photos(row)}


@app.patch("/api/candidates/{candidate_id}")
def edit_candidate(candidate_id: int, payload: CandidatePayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    row = fetch_one("SELECT id, room_id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
    if not row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    require_room_write(get_accessible_room(row["room_id"], user["id"]))
    candidate = normalize_candidate(payload)
    assignments = ", ".join(f"{column} = %s" for column in CANDIDATE_COLUMNS)
    execute(
        f"UPDATE candidates SET {assignments} WHERE id = %s",
        (*candidate_values(candidate), candidate_id),
    )
    updated = fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
    return {"candidate": candidate_with_photos(updated)}


@app.delete("/api/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(bolsaram_session)
    row = fetch_one("SELECT id, room_id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
    if not row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    require_room_write(get_accessible_room(row["room_id"], user["id"]))
    execute("DELETE FROM candidates WHERE id = %s", (candidate_id,))
    return {"ok": True}


@app.post("/api/rooms/{room_id}/sample")
def sample(room_id: str, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, room = get_accessible_room_id(room_id, user["id"])
    require_room_write(room)
    with db() as connection:
        connection.begin()
        try:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM match_logs WHERE room_id = %s", (db_room_id,))
                cursor.execute("DELETE FROM candidates WHERE room_id = %s", (db_room_id,))
                columns = ", ".join(("room_id", *CANDIDATE_COLUMNS))
                placeholders = ", ".join(["%s"] * (len(CANDIDATE_COLUMNS) + 1))
                for item in SAMPLE_CANDIDATES:
                    candidate = normalize_candidate({**item, "consent": True})
                    cursor.execute(
                        f"INSERT INTO candidates ({columns}) VALUES ({placeholders})",
                        (db_room_id, *candidate_values(candidate)),
                    )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    candidates = fetch_all("SELECT * FROM candidates WHERE room_id = %s ORDER BY created_at DESC", (db_room_id,))
    return {"candidates": serialize_candidates(candidates), "logs": []}


@app.patch("/api/candidates/{candidate_id}/status")
def update_status(candidate_id: int, payload: StatusPayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail="상태 값이 올바르지 않습니다.")
    row = fetch_one("SELECT id, room_id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
    if not row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    require_room_write(get_accessible_room(row["room_id"], user["id"]))
    execute("UPDATE candidates SET status = %s WHERE id = %s", (payload.status, candidate_id))
    execute(
        "INSERT INTO match_logs (room_id, candidate_id, status, log_date, memo) VALUES (%s, %s, %s, %s, '후보 상태 변경')",
        (row["room_id"], candidate_id, payload.status, today_label()),
    )
    candidate = fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
    logs = fetch_all("SELECT * FROM match_logs WHERE room_id = %s AND other_candidate_id IS NULL ORDER BY created_at DESC", (row["room_id"],))
    return {"candidate": candidate_with_photos(candidate), "logs": [serialize_log(log) for log in logs]}




@app.post("/api/kakao/skill")
async def kakao_skill(request: Request, x_kakao_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    require_kakao_api_key(x_kakao_api_key)
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    db_room_id = resolve_kakao_upload_room(payload if isinstance(payload, dict) else {})
    if not db_room_id:
        return kakao_skill_response("업로드 대상 방이 설정되지 않았습니다. 챗봇 파라미터 roomId 또는 KAKAO_DEFAULT_ROOM_ID를 설정해 주세요.")
    token, expires_at = issue_upload_token(db_room_id, kakao_user_key(payload if isinstance(payload, dict) else {}))
    upload_url = f"{app_base_url(request)}/upload?token={token}"
    return kakao_skill_response(
        f"프로필 등록 링크를 열어주세요. 링크는 {UPLOAD_TOKEN_TTL_MINUTES}분 동안 1회만 사용할 수 있습니다.",
        upload_url,
    )


@app.get("/api/upload-tokens/{token}")
def inspect_upload_token(token: str) -> dict[str, Any]:
    row = upload_token_or_error(token)
    return {
        "valid": True,
        "roomName": row.get("room_name") or "볼사람",
        "roomId": row.get("room_public_id"),
        "expiresAt": iso(row["expires_at"]),
        "ttlMinutes": UPLOAD_TOKEN_TTL_MINUTES,
    }


def candidate_limit_for_room(db_room_id: int) -> int:
    owner_plan = fetch_one("SELECT u.plan FROM rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = %s", (db_room_id,))
    return plan_limits(owner_plan["plan"] if owner_plan else "free")["candidates"]


def ensure_candidate_capacity(db_room_id: int) -> None:
    candidate_limit = candidate_limit_for_room(db_room_id)
    current_count = int(fetch_one("SELECT COUNT(*) AS c FROM candidates WHERE room_id = %s", (db_room_id,))["c"])
    if current_count >= candidate_limit:
        raise HTTPException(status_code=403, detail=f"이 방은 후보를 최대 {candidate_limit}명까지 등록할 수 있습니다.")


@app.post("/api/profiles", status_code=201)
async def create_profile_from_upload(
    token: str = Form(...),
    alias: str = Form(default=""),
    title: str = Form(default=""),
    description: str = Form(default=""),
    age: int = Form(...),
    region: str = Form(default=""),
    gender: str = Form(default="여"),
    job: str = Form(default=""),
    height: int | None = Form(default=None),
    ideal: str = Form(default=""),
    privacy: str = Form(default="그룹 내 공개"),
    image: UploadFile | None = File(default=None),
    images: list[UploadFile] | None = File(default=None),
) -> dict[str, Any]:
    row = upload_token_or_error(token)
    uploads = [item for item in ([image] if image and image.filename else []) + (images or []) if item and item.filename]
    if not uploads:
        raise HTTPException(status_code=400, detail="사진을 1장 이상 첨부해 주세요.")
    if len(uploads) > 3:
        raise HTTPException(status_code=400, detail="사진은 최대 3장까지 업로드할 수 있습니다.")
    if age < 18 or age > 80:
        raise HTTPException(status_code=400, detail="나이는 18세부터 80세까지 입력할 수 있습니다.")
    if height is not None and (height < 100 or height > 250):
        raise HTTPException(status_code=400, detail="키는 100cm부터 250cm까지 입력할 수 있습니다.")

    db_room_id = int(row["room_id"])
    ensure_candidate_capacity(db_room_id)
    birth_year = datetime.now().year - age
    normalized_gender = "남" if gender in ("남", "남성", "male", "M") else "여"
    display_alias = (alias or title or f"{birth_year}년생 {'남성' if normalized_gender == '남' else '여성'} 후보").strip()
    candidate = normalize_candidate({
        "alias": display_alias,
        "gender": normalized_gender,
        "birthYear": birth_year,
        "height": height,
        "location": region,
        "job": job,
        "education": "",
        "religion": "미입력",
        "smoke": "미입력",
        "drink": "미입력",
        "mbti": "",
        "personality": description,
        "hobbies": "",
        "ideal": ideal,
        "memo": description,
        "privacy": privacy,
        "status": "등록됨",
        "consent": True,
        "contact": "",
    })
    columns = ", ".join(("room_id", *CANDIDATE_COLUMNS))
    placeholders = ", ".join(["%s"] * (len(CANDIDATE_COLUMNS) + 1))
    candidate_id = execute(
        f"INSERT INTO candidates ({columns}) VALUES ({placeholders})",
        (db_room_id, *candidate_values(candidate)),
    )
    saved: dict[str, Any] | None = None
    for upload in uploads:
        saved = await store_candidate_photo(candidate_id, upload, str(row.get("room_public_id") or db_room_id))
    execute("UPDATE upload_tokens SET used_at = UTC_TIMESTAMP() WHERE id = %s", (row["id"],))
    execute(
        "INSERT INTO match_logs (room_id, candidate_id, status, log_date, memo) VALUES (%s, %s, '등록됨', %s, '카카오 업로드 등록')",
        (db_room_id, candidate_id, today_label()),
    )
    return {
        "ok": True,
        "candidate": saved or candidate_with_photos(fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))),
        "message": "프로필 등록이 완료되었습니다.",
    }


def watermark_image(data: bytes, label: str, extension: str) -> bytes:
    # 무단 재공유 억제용 워터마크. 실패하거나 GIF(애니메이션 손상 방지)면 원본을 그대로 둔다.
    if extension == ".gif":
        return data
    try:
        image = Image.open(BytesIO(data)).convert("RGBA")
    except Exception:
        return data
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    text = f"bolsaram · {label}"
    size = max(14, image.width // 24)
    try:
        font = ImageFont.truetype(WATERMARK_FONT_PATH, size)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    margin = max(8, size // 2)
    x = max(margin, image.width - text_width - margin)
    y = max(margin, image.height - text_height - margin * 2)
    draw.text((x + 1, y + 1), text, font=font, fill=(0, 0, 0, 120))
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 180))
    combined = Image.alpha_composite(image, overlay)
    out = BytesIO()
    if extension in (".jpg", ".jpeg"):
        combined.convert("RGB").save(out, format="JPEG", quality=88)
    elif extension == ".webp":
        combined.save(out, format="WEBP", quality=88)
    else:
        combined.save(out, format="PNG")
    return out.getvalue()


async def store_candidate_photo(candidate_id: int, file: UploadFile, room_label: str) -> dict[str, Any]:
    # 사진 1장을 워터마크 처리해 uploads에 저장하고 candidate_photos에 기록한다. 권한 검사는 호출부 책임이다.
    extension = IMAGE_EXTENSIONS.get(file.content_type or "")
    if not extension:
        raise HTTPException(status_code=400, detail="JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="이미지 용량은 8MB를 넘을 수 없습니다.")
    data = watermark_image(data, room_label, extension)
    filename = f"{secrets.token_hex(16)}{extension}"
    (UPLOAD_DIR / filename).write_bytes(data)
    existing = fetch_all("SELECT id FROM candidate_photos WHERE candidate_id = %s", (candidate_id,))
    execute(
        "INSERT INTO candidate_photos (candidate_id, image_url, sort_order, is_primary) VALUES (%s, %s, %s, %s)",
        (candidate_id, f"/api/uploads/{filename}", len(existing), 0 if existing else 1),
    )
    full = fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
    return candidate_with_photos(full)


@app.post("/api/candidates/{candidate_id}/photos", status_code=201)
async def upload_photo(candidate_id: int, file: UploadFile = File(...), bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    row = fetch_one("SELECT id, room_id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
    if not row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    room = get_accessible_room(row["room_id"], user["id"])
    require_room_write(room)
    candidate = await store_candidate_photo(candidate_id, file, str(room.get("id") or "bolsaram"))
    return {"candidate": candidate}


@app.post("/api/candidates/{candidate_id}/upload-code", status_code=201)
def create_upload_code(candidate_id: int, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    row = fetch_one("SELECT id, room_id, alias FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
    if not row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    room = get_accessible_room(row["room_id"], user["id"])
    require_room_write(room)
    # 같은 후보의 기존 코드는 정리해 코드가 누적되지 않게 한다.
    execute("DELETE FROM candidate_upload_codes WHERE candidate_id = %s", (candidate_id,))
    code = unique_upload_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=UPLOAD_CODE_TTL_MINUTES)
    execute(
        "INSERT INTO candidate_upload_codes (candidate_id, code, created_by, expires_at, max_uses) VALUES (%s, %s, %s, %s, %s)",
        (candidate_id, code, user["id"], expires_at.strftime("%Y-%m-%d %H:%M:%S"), UPLOAD_CODE_MAX_USES),
    )
    return {
        "code": code,
        "candidateId": str(candidate_id),
        "alias": row.get("alias"),
        "expiresAt": iso(expires_at),
        "ttlMinutes": UPLOAD_CODE_TTL_MINUTES,
        "maxUses": UPLOAD_CODE_MAX_USES,
    }


@app.post("/api/kakao/photos", status_code=201)
async def kakao_upload_photo(
    code: str = Form(...),
    file: UploadFile = File(...),
    x_kakao_api_key: str | None = Header(default=None),
) -> dict[str, Any]:
    # 카카오 챗봇 스킬 서버 전용. 쿠키 대신 공용 API 키 + 후보별 업로드 코드로 인증한다.
    if not KAKAO_API_KEY:
        raise HTTPException(status_code=503, detail="카카오 업로드가 설정되지 않았습니다.")
    if not x_kakao_api_key or not hmac.compare_digest(x_kakao_api_key, KAKAO_API_KEY):
        raise HTTPException(status_code=401, detail="인증에 실패했습니다.")
    normalized = (code or "").strip().upper()
    row = fetch_one(
        "SELECT *, (expires_at <= NOW()) AS expired FROM candidate_upload_codes WHERE code = %s LIMIT 1",
        (normalized,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="유효하지 않은 업로드 코드입니다.")
    if row["expired"]:
        raise HTTPException(status_code=410, detail="업로드 코드가 만료되었습니다. 새 코드를 발급받으세요.")
    if row["used_count"] >= row["max_uses"]:
        raise HTTPException(status_code=429, detail="업로드 코드의 사용 횟수를 초과했습니다.")
    candidate_row = fetch_one("SELECT id, room_id, alias FROM candidates WHERE id = %s LIMIT 1", (row["candidate_id"],))
    if not candidate_row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    candidate = await store_candidate_photo(candidate_row["id"], file, str(candidate_row["room_id"] or "bolsaram"))
    execute("UPDATE candidate_upload_codes SET used_count = used_count + 1 WHERE id = %s", (row["id"],))
    remaining = max(0, row["max_uses"] - row["used_count"] - 1)
    return {
        "ok": True,
        "alias": candidate_row.get("alias"),
        "photoCount": len(candidate.get("photos", [])),
        "remainingUses": remaining,
        "message": f"{candidate_row.get('alias') or '후보'} 사진을 추가했습니다. (남은 업로드 {remaining}회)",
    }


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    photo = fetch_one(
        """
        SELECT p.id, p.candidate_id, p.image_url, p.is_primary, c.room_id
          FROM candidate_photos p
          JOIN candidates c ON c.id = p.candidate_id
         WHERE p.id = %s LIMIT 1
        """,
        (photo_id,),
    )
    if not photo:
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")
    require_room_write(get_accessible_room(photo["room_id"], user["id"]))
    execute("DELETE FROM candidate_photos WHERE id = %s", (photo_id,))
    filename = str(photo["image_url"]).rsplit("/", 1)[-1]
    target = UPLOAD_DIR / filename
    if target.is_file():
        target.unlink()
    # 대표 사진이 삭제되면 남은 첫 사진을 대표로 승격한다.
    if photo["is_primary"]:
        nxt = fetch_one("SELECT id FROM candidate_photos WHERE candidate_id = %s ORDER BY sort_order, id LIMIT 1", (photo["candidate_id"],))
        if nxt:
            execute("UPDATE candidate_photos SET is_primary = 1 WHERE id = %s", (nxt["id"],))
    full = fetch_one("SELECT * FROM candidates WHERE id = %s", (photo["candidate_id"],))
    return {"candidate": candidate_with_photos(full)}

