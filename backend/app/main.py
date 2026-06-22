from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

import pymysql
from fastapi import Cookie, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

BASE_DIR = Path(__file__).resolve().parents[2]
SCHEMA_SQL_PATH = BASE_DIR / "sql" / "schema.sql"

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
STATUSES = [
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
]

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
        "status": "소개 가능",
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
        "status": "검토 중",
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
        "status": "소개 가능",
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
        "status": "제안 완료",
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


class StatusPayload(BaseModel):
    status: str


class LogPayload(BaseModel):
    candidateId: int
    otherId: int | None = None


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
    return datetime.now().strftime("%Y.%m.%d")


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


def public_user(user: dict[str, Any]) -> dict[str, str]:
    return {"id": str(user["id"]), "name": user["name"], "email": user["email"]}


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


def serialize_candidate(row: dict[str, Any]) -> dict[str, Any]:
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
        "createdAt": iso(row["created_at"]),
    }


def serialize_log(row: dict[str, Any]) -> dict[str, Any]:
    pair = [str(row["candidate_id"])]
    if row.get("other_candidate_id"):
        pair.append(str(row["other_candidate_id"]))
    return {
        "id": str(row["id"]),
        "roomId": str(row["room_id"]),
        "pair": pair,
        "status": row["status"],
        "date": row["log_date"],
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
    }


def current_user(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return fetch_one(
        """
        SELECT u.id, u.name, u.email
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
                cursor.execute(
                    "INSERT INTO rooms (public_id, owner_id, name, visibility) VALUES (%s, %s, %s, 'public')",
                    (unique_room_public_id(), user_id, f"{payload.name.strip()}님의 공개방"),
                )
                room_id = int(cursor.lastrowid)
                cursor.execute(
                    "INSERT INTO room_members (room_id, user_id, role) VALUES (%s, %s, 'owner')",
                    (room_id, user_id),
                )
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
    logs = fetch_all("SELECT * FROM match_logs WHERE room_id = %s ORDER BY created_at DESC", (db_room_id,))
    return {"room": room, "candidates": [serialize_candidate(row) for row in candidates], "logs": [serialize_log(row) for row in logs]}


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


@app.post("/api/rooms/{room_id}/candidates", status_code=201)
def create_candidate(room_id: str, payload: CandidatePayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, _ = get_accessible_room_id(room_id, user["id"])
    candidate = normalize_candidate(payload)
    candidate_id = execute(
        """
        INSERT INTO candidates
          (room_id, alias, gender, birth_year, height, location, job, education, religion, smoke, drink, mbti, personality, hobbies, ideal, memo, privacy, status, color)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            db_room_id,
            candidate["alias"],
            candidate["gender"],
            candidate["birth_year"],
            candidate["height"],
            candidate["location"],
            candidate["job"],
            candidate["education"],
            candidate["religion"],
            candidate["smoke"],
            candidate["drink"],
            candidate["mbti"],
            candidate["personality"],
            candidate["hobbies"],
            candidate["ideal"],
            candidate["memo"],
            candidate["privacy"],
            candidate["status"],
            candidate["color"],
        ),
    )
    row = fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
    return {"candidate": serialize_candidate(row)}


@app.post("/api/rooms/{room_id}/sample")
def sample(room_id: str, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, _ = get_accessible_room_id(room_id, user["id"])
    with db() as connection:
        connection.begin()
        try:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM match_logs WHERE room_id = %s", (db_room_id,))
                cursor.execute("DELETE FROM candidates WHERE room_id = %s", (db_room_id,))
                for item in SAMPLE_CANDIDATES:
                    candidate = normalize_candidate(item)
                    cursor.execute(
                        """
                        INSERT INTO candidates
                          (room_id, alias, gender, birth_year, height, location, job, education, religion, smoke, drink, mbti, personality, hobbies, ideal, memo, privacy, status, color)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            db_room_id,
                            candidate["alias"],
                            candidate["gender"],
                            candidate["birth_year"],
                            candidate["height"],
                            candidate["location"],
                            candidate["job"],
                            candidate["education"],
                            candidate["religion"],
                            candidate["smoke"],
                            candidate["drink"],
                            candidate["mbti"],
                            candidate["personality"],
                            candidate["hobbies"],
                            candidate["ideal"],
                            candidate["memo"],
                            candidate["privacy"],
                            candidate["status"],
                            candidate["color"],
                        ),
                    )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    candidates = fetch_all("SELECT * FROM candidates WHERE room_id = %s ORDER BY created_at DESC", (db_room_id,))
    return {"candidates": [serialize_candidate(row) for row in candidates], "logs": []}


@app.patch("/api/candidates/{candidate_id}/status")
def update_status(candidate_id: int, payload: StatusPayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail="상태 값이 올바르지 않습니다.")
    row = fetch_one("SELECT id, room_id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
    if not row:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    get_accessible_room(row["room_id"], user["id"])
    execute("UPDATE candidates SET status = %s WHERE id = %s", (payload.status, candidate_id))
    execute(
        "INSERT INTO match_logs (room_id, candidate_id, status, log_date, memo) VALUES (%s, %s, %s, %s, '후보 상태 변경')",
        (row["room_id"], candidate_id, payload.status, today_label()),
    )
    candidate = fetch_one("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
    logs = fetch_all("SELECT * FROM match_logs WHERE room_id = %s ORDER BY created_at DESC", (row["room_id"],))
    return {"candidate": serialize_candidate(candidate), "logs": [serialize_log(log) for log in logs]}


@app.post("/api/rooms/{room_id}/logs", status_code=201)
def create_log(room_id: str, payload: LogPayload, bolsaram_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(bolsaram_session)
    db_room_id, _ = get_accessible_room_id(room_id, user["id"])
    candidate = fetch_one("SELECT id FROM candidates WHERE room_id = %s AND id = %s", (db_room_id, payload.candidateId))
    if not candidate:
        raise HTTPException(status_code=404, detail="후보를 찾을 수 없습니다.")
    if payload.otherId:
        other = fetch_one("SELECT id FROM candidates WHERE room_id = %s AND id = %s", (db_room_id, payload.otherId))
        if not other:
            raise HTTPException(status_code=404, detail="상대 후보를 찾을 수 없습니다.")
    execute("UPDATE candidates SET status = '검토 중' WHERE id = %s", (payload.candidateId,))
    log_id = execute(
        """
        INSERT INTO match_logs (room_id, candidate_id, other_candidate_id, status, log_date, memo)
        VALUES (%s, %s, %s, '검토 중', %s, '추천 후보 검토 등록')
        """,
        (db_room_id, payload.candidateId, payload.otherId, today_label()),
    )
    log = fetch_one("SELECT * FROM match_logs WHERE id = %s", (log_id,))
    candidates = fetch_all("SELECT * FROM candidates WHERE room_id = %s ORDER BY created_at DESC", (db_room_id,))
    return {"log": serialize_log(log), "candidates": [serialize_candidate(row) for row in candidates]}
