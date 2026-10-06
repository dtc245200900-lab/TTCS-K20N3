import json
import os
import re
import sys
import time
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import bcrypt
import mysql.connector
import requests
from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory, session, url_for
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
ROOMS_FILE = DATA_DIR / "rooms.json"
ROOM_TYPES_FILE = DATA_DIR / "room-types.json"
USERS_FILE = DATA_DIR / "users.json"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ROOM_STATUSES = {"Phòng trống", "Đã thuê", "Bảo trì"}

load_dotenv(BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)
secret = os.getenv("SESSION_SECRET")
if not secret and os.getenv("NODE_ENV") == "production":
    raise RuntimeError("SESSION_SECRET is required when NODE_ENV=production.")
app.secret_key = secret or "local-only-session-secret-change-before-production"
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("NODE_ENV") == "production",
    PERMANENT_SESSION_LIFETIME=8 * 60 * 60,
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,
)

oauth = OAuth(app)
oauth_clients = {}


def register_oauth_client(provider, client_id_name, client_secret_name, **options):
    client_id = os.getenv(client_id_name)
    client_secret = os.getenv(client_secret_name)
    if client_id and client_secret:
        oauth_clients[provider] = oauth.register(
            name=provider,
            client_id=client_id,
            client_secret=client_secret,
            **options,
        )


register_oauth_client(
    "google",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

microsoft_tenant = os.getenv("MICROSOFT_TENANT_ID", "common")
if not re.fullmatch(r"[A-Za-z0-9.-]+", microsoft_tenant):
    microsoft_tenant = "common"
register_oauth_client(
    "microsoft",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    authorize_url=f"https://login.microsoftonline.com/{microsoft_tenant}/oauth2/v2.0/authorize",
    access_token_url=f"https://login.microsoftonline.com/{microsoft_tenant}/oauth2/v2.0/token",
    api_base_url="https://graph.microsoft.com/v1.0/",
    client_kwargs={"scope": "User.Read"},
)

register_oauth_client(
    "github",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    authorize_url="https://github.com/login/oauth/authorize",
    access_token_url="https://github.com/login/oauth/access_token",
    api_base_url="https://api.github.com/",
    client_kwargs={"scope": "read:user user:email"},
)


class OAuthProfileError(Exception):
    pass

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "hotel_management"),
    "charset": "utf8mb4",
    "connection_timeout": 2,
}


def db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def db_available():
    try:
        connection = db_connection()
        connection.close()
        return True
    except mysql.connector.Error:
        return False


def query(sql, params=(), fetch=False):
    connection = db_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        rows = cursor.fetchall() if fetch else None
        result = {"rows": rows, "lastrowid": cursor.lastrowid, "rowcount": cursor.rowcount}
        connection.commit()
        return result
    finally:
        cursor.close()
        connection.close()


def initialize_database():
    try:
        connection = db_connection()
        cursor = connection.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rooms (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                room_code VARCHAR(30) NOT NULL,
                short_description TEXT NULL,
                image_path VARCHAR(255) NULL,
                room_type VARCHAR(80) NOT NULL,
                nightly_rate DECIMAL(12,2) NOT NULL,
                status ENUM('Phòng trống', 'Đã thuê', 'Bảo trì') NOT NULL DEFAULT 'Phòng trống',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                checked_in_at DATETIME NULL,
                checked_out_at DATETIME NULL,
                rental_duration_seconds BIGINT UNSIGNED NULL,
                rental_duration_minutes BIGINT UNSIGNED NULL,
                rental_days INT NULL,
                rental_total DECIMAL(14,2) NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_rooms_code (room_code),
                CHECK (nightly_rate > 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        cursor.execute("SHOW COLUMNS FROM rooms")
        columns = {row[0] for row in cursor.fetchall()}
        if "room_code" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN room_code VARCHAR(30) NULL AFTER id")
            cursor.execute("ALTER TABLE rooms ADD COLUMN short_description TEXT NULL AFTER room_code")
            cursor.execute("ALTER TABLE rooms ADD COLUMN image_path VARCHAR(255) NULL AFTER short_description")
            cursor.execute("ALTER TABLE rooms ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
            if "room_number" in columns:
                cursor.execute("UPDATE rooms SET room_code = room_number WHERE room_code IS NULL")
            cursor.execute("UPDATE rooms SET room_code = CONCAT('ROOM-', id) WHERE room_code IS NULL OR room_code = ''")
            cursor.execute("ALTER TABLE rooms MODIFY room_code VARCHAR(30) NOT NULL")
            cursor.execute("ALTER TABLE rooms ADD UNIQUE KEY uq_rooms_code (room_code)")
        if "checked_in_at" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN checked_in_at DATETIME NULL")
        if "checked_out_at" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN checked_out_at DATETIME NULL")
        if "rental_duration_seconds" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN rental_duration_seconds BIGINT UNSIGNED NULL")
        if "rental_duration_minutes" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN rental_duration_minutes BIGINT UNSIGNED NULL")
        if "rental_days" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN rental_days INT NULL")
        if "rental_total" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN rental_total DECIMAL(14,2) NULL")
        else:
            cursor.execute("ALTER TABLE rooms MODIFY rental_total DECIMAL(14,2) NULL")
        cursor.execute("ALTER TABLE rooms MODIFY room_type VARCHAR(80) NOT NULL")
        cursor.execute("ALTER TABLE rooms MODIFY status VARCHAR(30) NOT NULL DEFAULT 'Phòng trống'")
        cursor.execute("""
            UPDATE rooms SET status = CASE LOWER(status)
                WHEN 'available' THEN 'Phòng trống'
                WHEN 'occupied' THEN 'Đã thuê'
                WHEN 'maintenance' THEN 'Bảo trì'
                ELSE status END
        """)
        cursor.execute("ALTER TABLE rooms MODIFY status ENUM('Phòng trống', 'Đã thuê', 'Bảo trì') NOT NULL DEFAULT 'Phòng trống'")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS room_types (
                code VARCHAR(16) NOT NULL,
                name VARCHAR(80) NOT NULL,
                description TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (code),
                UNIQUE KEY uq_room_types_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rental_history (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                room_id BIGINT UNSIGNED NOT NULL,
                checked_in_at DATETIME NOT NULL,
                scheduled_check_out_at DATETIME NULL,
                returned_at DATETIME NOT NULL,
                duration_minutes BIGINT UNSIGNED NOT NULL,
                rental_total DECIMAL(14,2) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_rental_history_room (room_id, created_at),
                CONSTRAINT fk_rental_history_room FOREIGN KEY (room_id) REFERENCES rooms (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        cursor.execute("SHOW COLUMNS FROM rental_history")
        rental_history_columns = {row[0]: row[2] for row in cursor.fetchall()}
        if rental_history_columns.get("scheduled_check_out_at") == "NO":
            cursor.execute("ALTER TABLE rental_history MODIFY scheduled_check_out_at DATETIME NULL")
        cursor.execute("SHOW COLUMNS FROM room_types")
        room_type_columns = {row[0] for row in cursor.fetchall()}
        if "description" not in room_type_columns:
            cursor.execute("ALTER TABLE room_types ADD COLUMN description TEXT NULL AFTER name")
        connection.commit()
    except mysql.connector.Error as error:
        print(f"MySQL chưa sẵn sàng, sẽ dùng lưu trữ dự phòng JSON: {error}")
    finally:
        if "cursor" in locals():
            cursor.close()
        if "connection" in locals() and connection.is_connected():
            connection.close()


def read_json(path, default):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        write_json(path, default)
        return default.copy() if isinstance(default, list) else default
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, type(default)) else default.copy() if isinstance(default, list) else default
    except (OSError, json.JSONDecodeError):
        return default.copy() if isinstance(default, list) else default


def write_json(path, value):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def public_user(user):
    return {
        "id": user["id"],
        "email": user["email"],
        "fullName": user["fullName"],
        "dateOfBirth": user.get("dateOfBirth", ""),
        "phone": user.get("phone", ""),
        "avatar": user.get("avatar", ""),
    }


def users():
    existing = read_json(USERS_FILE, [])
    if not existing:
        password_hash = bcrypt.hashpw(b"Admin@123", bcrypt.gensalt(rounds=12)).decode("utf-8")
        existing = [{"id": 1, "email": "admin@hotel.local", "passwordHash": password_hash, "fullName": "Quản trị viên"}]
        write_json(USERS_FILE, existing)
    return existing


def find_user(email):
    return next((user for user in users() if user.get("email") == email), None)


def normalized_status(value):
    status = str(value or "").strip().lower()
    aliases = {
        "available": "Phòng trống", "phòng trống": "Phòng trống",
        "occupied": "Đã thuê", "rented": "Đã thuê", "đã thuê": "Đã thuê",
        "đã cho thuê": "Đã thuê", "đang thuê": "Đã thuê", "đang cho thuê": "Đã thuê",
        "maintenance": "Bảo trì", "bảo trì": "Bảo trì",
    }
    return aliases.get(status, str(value or "").strip())


def current_room_rental_total(room):
    if normalized_status(room.get("status")) != "Đã thuê":
        return None

    def value(*keys):
        return next((room[key] for key in keys if room.get(key) is not None), None)

    try:
        rate = Decimal(str(value("nightly_rate", "nightlyRate")))
        checked_in_at = parse_datetime_value(value("checked_in_at", "checkInAt"))
        scheduled_check_out = parse_datetime_value(value("checked_out_at", "checkOutAt"))
        if checked_in_at is None or not rate.is_finite() or rate <= 0:
            return None
        local_check_in = checked_in_at.astimezone() if checked_in_at.tzinfo else checked_in_at.astimezone()
        calculation_end = scheduled_check_out or datetime.now().astimezone()
        local_end = calculation_end.astimezone() if calculation_end.tzinfo else calculation_end.astimezone()
        elapsed_seconds = (local_end - local_check_in).total_seconds()
        if elapsed_seconds <= 0:
            return None
        elapsed_minutes = max(1, int(elapsed_seconds // 60))
        return float(max(Decimal("1"), calculate_rental_total(rate, elapsed_minutes)))
    except (InvalidOperation, TypeError, ValueError, OverflowError):
        return None


def normalize_room(room):
    def get(*keys, default=None):
        for key in keys:
            if room.get(key) is not None:
                return room[key]
        return default

    rate = get("nightly_rate", "nightlyRate", default=0)
    if isinstance(rate, Decimal):
        rate = float(rate)
    return {
        "id": get("id"),
        "roomCode": get("room_code", "roomCode", "roomNumber", default=""),
        "shortDescription": get("short_description", "shortDescription", default=""),
        "imagePath": get("image_path", "imagePath", default=""),
        "roomType": get("room_type", "roomType", default="Đơn"),
        "nightlyRate": float(rate or 0),
        "status": normalized_status(get("status", default="Phòng trống")),
        "checkInAt": iso_value(get("checked_in_at", "checkInAt")),
        "checkOutAt": iso_value(get("checked_out_at", "checkOutAt")),
        "rentalDurationSeconds": get("rental_duration_seconds", "rentalDurationSeconds"),
        "rentalDurationMinutes": get("rental_duration_minutes", "rentalDurationMinutes"),
        "rentalDays": get("rental_days", "rentalDays"),
        "rentalTotal": float(get("rental_total", "rentalTotal")) if get("rental_total", "rentalTotal") is not None else None,
        "currentRentalTotal": current_room_rental_total(room),
        "createdAt": iso_value(get("created_at", "createdAt")),
    }


def iso_value(value):
    return value.isoformat() if isinstance(value, (datetime, date)) else value


def parse_datetime_value(value):
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value)) if value else None


def calculate_rental_total(nightly_rate, duration_minutes):
    try:
        rate = Decimal(str(nightly_rate))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Giá phòng không hợp lệ.")
    if not rate.is_finite() or rate <= 0:
        raise ValueError("Giá phòng không hợp lệ.")
    return (rate * Decimal(duration_minutes) / Decimal(1440)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def norm_name(value):
    return " ".join(str(value or "").split()).casefold()


def next_type_code(room_types):
    highest = 0
    for room_type in room_types:
        match = re.fullmatch(r"LP(\d+)", str(room_type.get("code", "")), re.IGNORECASE)
        if match:
            highest = max(highest, int(match.group(1)))
    return f"LP{highest + 1:03d}"


def list_room_types():
    if db_available():
        room_rows = query("SELECT DISTINCT room_type FROM rooms", fetch=True)["rows"]
        type_rows = query("SELECT code, name, description FROM room_types ORDER BY code", fetch=True)["rows"]
        types = [{"code": row["code"], "name": row["name"], "description": row.get("description") or ""} for row in type_rows]
        if not type_rows and not room_rows:
            json_types = read_json(ROOM_TYPES_FILE, [])
            if json_types:
                return json_types
        names = ([] if types else ["Đơn", "Đôi", "VIP"]) + [row["room_type"] for row in room_rows]
        for name in names:
            if not str(name or "").strip() or any(norm_name(item["name"]) == norm_name(name) for item in types):
                continue
            code = next_type_code(types)
            try:
                query("INSERT INTO room_types (code, name, description) VALUES (%s, %s, %s)", (code, str(name).strip(), ""))
                types.append({"code": code, "name": str(name).strip(), "description": ""})
            except mysql.connector.IntegrityError:
                pass
        rows = query("SELECT code, name, description FROM room_types ORDER BY code", fetch=True)["rows"]
        if rows:
            return [{"code": row["code"], "name": row["name"], "description": row.get("description") or ""} for row in rows]

    types = read_json(ROOM_TYPES_FILE, [])
    rooms = read_json(ROOMS_FILE, [])
    if not types and not rooms:
        types = [{"code": "LP001", "name": "Đơn", "description": ""}, {"code": "LP002", "name": "Đôi", "description": ""}, {"code": "LP003", "name": "VIP", "description": ""}]
        write_json(ROOM_TYPES_FILE, types)
        return types
    names = ([] if types else ["Đơn", "Đôi", "VIP"])
    names.extend(room.get("roomType", room.get("room_type")) for room in rooms)
    for name in names:
        if not str(name or "").strip() or any(norm_name(item.get("name")) == norm_name(name) for item in types):
            continue
        types.append({"code": next_type_code(types), "name": str(name).strip(), "description": ""})
    write_json(ROOM_TYPES_FILE, types)
    return types


def find_room_type(name):
    target = norm_name(name)
    return next((item for item in list_room_types() if norm_name(item["name"]) == target), None)


def list_rooms():
    if db_available():
        rows = query("SELECT * FROM rooms ORDER BY created_at DESC, id DESC", fetch=True)["rows"]
        if not rows:
            json_rows = read_json(ROOMS_FILE, [])
            if json_rows:
                return [normalize_room(room) for room in json_rows]
    else:
        rows = read_json(ROOMS_FILE, [])
    return [normalize_room(room) for room in rows]


def room_by_id(room_id):
    if db_available():
        rows = query("SELECT * FROM rooms WHERE id = %s LIMIT 1", (room_id,), fetch=True)["rows"]
        if rows:
            return normalize_room(rows[0])
        json_rows = read_json(ROOMS_FILE, [])
        room = next((item for item in json_rows if str(item.get("id")) == str(room_id)), None)
        return normalize_room(room) if room else None
    rows = read_json(ROOMS_FILE, [])
    room = next((item for item in rows if str(item.get("id")) == str(room_id)), None)
    return normalize_room(room) if room else None


def require_auth():
    if not session.get("user"):
        return jsonify(message="Bạn cần đăng nhập để tiếp tục."), 401
    return None


def request_data():
    return request.get_json(silent=True) or request.form


@app.get("/health")
def health():
    return jsonify(status="ok", runtime="python")


@app.get("/")
def index():
    return redirect("/login.html")


@app.get("/home")
def home_page():
    if not session.get("user"):
        return redirect("/login.html")
    return send_from_directory(FRONTEND_DIR / "pages", "home.html")


@app.get("/api/session")
def get_session():
    return jsonify(user=session.get("user"))


@app.put("/api/profile")
def update_profile():
    denied = require_auth()
    if denied:
        return denied

    full_name = str(request.form.get("fullName", "")).strip()
    date_of_birth = str(request.form.get("dateOfBirth", "")).strip()
    phone = str(request.form.get("phone", "")).strip()
    if not 2 <= len(full_name) <= 150:
        return jsonify(message="Họ và tên phải có từ 2 đến 150 ký tự."), 400
    try:
        parsed_date = datetime.strptime(date_of_birth, "%Y-%m-%d").date()
        if parsed_date > date.today():
            raise ValueError
    except ValueError:
        return jsonify(message="Vui lòng nhập ngày sinh hợp lệ, không ở trong tương lai."), 400
    digits = re.sub(r"\D", "", phone)
    if not re.fullmatch(r"[+0-9() -]{7,20}", phone) or not 7 <= len(digits) <= 15:
        return jsonify(message="Vui lòng nhập số điện thoại hợp lệ."), 400

    all_users = users()
    current_user = session["user"]
    user = next((item for item in all_users if str(item.get("id")) == str(current_user.get("id"))), None)
    if not user:
        return jsonify(message="Không tìm thấy tài khoản người dùng."), 404

    avatar = request.files.get("avatar")
    if avatar and avatar.filename:
        allowed_extensions = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
        }
        extension = allowed_extensions.get(avatar.mimetype)
        if not extension:
            return jsonify(message="Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF."), 400
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{time.time_ns()}-{user['id']}-avatar{extension}"
        avatar.save(UPLOAD_DIR / filename)
        user["avatar"] = f"/uploads/{filename}"

    user.update(fullName=full_name, dateOfBirth=date_of_birth, phone=phone)
    write_json(USERS_FILE, all_users)
    session["user"] = public_user(user)
    return jsonify(message="Cập nhật thông tin cá nhân thành công", user=session["user"])


@app.post("/api/login")
def login():
    data = request_data()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not email or not password:
        return jsonify(message="Vui lòng nhập email và mật khẩu."), 400
    user = find_user(email)
    try:
        valid = user and bcrypt.checkpw(password.encode("utf-8"), user["passwordHash"].encode("utf-8"))
    except (ValueError, KeyError):
        valid = False
    if not valid:
        return jsonify(message="Email hoặc mật khẩu không chính xác."), 401
    session.clear()
    session["user"] = public_user(user)
    session.permanent = data.get("rememberMe") is True or str(data.get("rememberMe", "")).lower() == "true"
    return jsonify(message="Đăng nhập thành công.", user=session["user"])


@app.post("/api/register")
def register():
    data = request_data()
    full_name = str(data.get("fullName", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    confirm = str(data.get("confirmPassword", ""))
    if len(full_name) < 2 or not email or len(password) < 8:
        return jsonify(message="Vui lòng nhập họ tên, email hợp lệ và mật khẩu tối thiểu 8 ký tự."), 400
    if password != confirm:
        return jsonify(message="Mật khẩu xác nhận không trùng khớp."), 400
    all_users = users()
    if any(item.get("email") == email for item in all_users):
        return jsonify(message="Email này đã được sử dụng."), 409
    user = {
        "id": max((item.get("id", 0) for item in all_users), default=0) + 1,
        "email": email,
        "passwordHash": bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8"),
        "fullName": full_name,
    }
    all_users.append(user)
    write_json(USERS_FILE, all_users)
    return jsonify(message="Tạo tài khoản thành công. Bạn có thể đăng nhập ngay.", user=public_user(user)), 201


def oauth_error_redirect(flow, error_code):
    page = "register.html" if flow == "register" else "login.html"
    return redirect(f"/{page}?oauth_error={error_code}")


def social_profile(provider, client, token):
    if provider == "github":
        user_response = client.get("user")
        user_response.raise_for_status()
        profile = user_response.json()
        emails_response = client.get("user/emails")
        emails_response.raise_for_status()
        verified_email = next(
            (
                item.get("email")
                for item in emails_response.json()
                if item.get("primary") and item.get("verified")
            ),
            None,
        )
        subject = profile.get("id")
        email = verified_email
        full_name = profile.get("name") or profile.get("login")
    elif provider == "microsoft":
        response = client.get("me", params={"$select": "id,displayName,mail,userPrincipalName"})
        response.raise_for_status()
        profile = response.json()
        subject = profile.get("id")
        email = profile.get("mail") or profile.get("userPrincipalName")
        full_name = profile.get("displayName")
    else:
        profile = token.get("userinfo")
        if not profile:
            response = client.get("userinfo")
            response.raise_for_status()
            profile = response.json()

        if provider == "google" and profile.get("email_verified") is not True:
            raise OAuthProfileError("email_not_verified")
        subject = profile.get("sub")
        email = profile.get("email") or profile.get("preferred_username")
        full_name = profile.get("name")

    email = str(email or "").strip().lower()
    if not subject or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise OAuthProfileError("email_not_verified")

    full_name = str(full_name or email.split("@", 1)[0]).strip()[:200]
    return str(subject), email, full_name


def find_or_create_oauth_user(provider, subject, email, full_name):
    all_users = users()
    user = next(
        (
            item
            for item in all_users
            if isinstance(item.get("oauthAccounts"), dict)
            and item["oauthAccounts"].get(provider) == subject
        ),
        None,
    )
    if user:
        return user

    if any(str(item.get("email", "")).strip().lower() == email for item in all_users):
        raise OAuthProfileError("email_exists")

    user = {
        "id": max((item.get("id", 0) for item in all_users), default=0) + 1,
        "email": email,
        "fullName": full_name,
        "passwordHash": "",
        "oauthAccounts": {provider: subject},
    }
    all_users.append(user)
    write_json(USERS_FILE, all_users)
    return user


@app.get("/auth/<provider>")
def oauth_login(provider):
    if provider not in {"google", "microsoft", "github"}:
        return redirect("/login.html?oauth_error=oauth_failed")

    flow = request.args.get("flow", "login")
    if flow not in {"login", "register"}:
        flow = "login"

    client = oauth_clients.get(provider)
    if not client:
        return oauth_error_redirect(flow, "provider_not_configured")

    session[f"oauth_flow_{provider}"] = flow
    try:
        callback_url = url_for("oauth_callback", provider=provider, _external=True)
        return client.authorize_redirect(callback_url)
    except Exception as error:
        app.logger.warning("OAuth redirect failed for %s (%s)", provider, type(error).__name__)
        return oauth_error_redirect(flow, "oauth_failed")


@app.get("/auth/<provider>/callback")
def oauth_callback(provider):
    flow = session.pop(f"oauth_flow_{provider}", "login")
    if flow not in {"login", "register"}:
        flow = "login"

    client = oauth_clients.get(provider)
    if not client:
        return oauth_error_redirect(flow, "provider_not_configured")

    try:
        token = client.authorize_access_token()
        subject, email, full_name = social_profile(provider, client, token)
        user = find_or_create_oauth_user(provider, subject, email, full_name)
    except OAuthProfileError as error:
        return oauth_error_redirect(flow, str(error))
    except (OAuthError, requests.RequestException, ValueError, KeyError, TypeError) as error:
        app.logger.warning("OAuth callback failed for %s (%s)", provider, type(error).__name__)
        return oauth_error_redirect(flow, "oauth_failed")
    except Exception as error:
        app.logger.exception("Unexpected OAuth callback failure for %s (%s)", provider, type(error).__name__)
        return oauth_error_redirect(flow, "oauth_failed")

    session.clear()
    session["user"] = public_user(user)
    return redirect("/home")


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(message="Đăng xuất thành công.")


@app.get("/api/home")
def api_home():
    denied = require_auth()
    if denied:
        return denied
    return jsonify(message="Bạn đã truy cập trang chủ.", user=session["user"])


@app.get("/api/rooms")
def get_rooms():
    denied = require_auth()
    if denied:
        return denied
    try:
        return jsonify(rooms=list_rooms())
    except mysql.connector.Error as error:
        return jsonify(message=str(error) or "Không thể tải danh sách phòng."), 500


def save_upload():
    image = request.files.get("image")
    if not image or not image.filename:
        return ""
    if image.mimetype not in ALLOWED_IMAGE_TYPES:
        raise ValueError("Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF.")
    original = Path(image.filename)
    extension = original.suffix.lower()
    stem = secure_filename(original.stem).replace(" ", "-")[:50] or "room"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{int(time.time() * 1000)}-{stem}{extension}"
    image.save(UPLOAD_DIR / filename)
    return f"/uploads/{filename}"


def read_room_fields(data):
    code = str(data.get("roomCode", "")).strip()
    description = str(data.get("shortDescription", "")).strip()
    room_type = str(data.get("roomType", "")).strip()
    try:
        rate = float(data.get("nightlyRate", ""))
    except (TypeError, ValueError):
        rate = float("nan")
    return code, description, room_type, rate


@app.post("/api/rooms")
def add_room():
    denied = require_auth()
    if denied:
        return denied
    code, description, room_type, rate = read_room_fields(request.form)
    if not re.fullmatch(r"[A-Za-z0-9-]+", code) or len(description) > 240 or not code or not room_type or not description or not (rate > 0 and rate < float("inf")):
        return jsonify(message="Vui lòng nhập đầy đủ mã phòng, mô tả, thể loại và giá thuê > 0."), 400
    try:
        image_path = save_upload()
        if not find_room_type(room_type):
            raise ValueError("Loại phòng không hợp lệ.")
        existing = next((room for room in list_rooms() if room["roomCode"].casefold() == code.casefold()), None)
        if existing:
            raise ValueError("Mã phòng đã tồn tại.")
        if db_available():
            result = query("INSERT INTO rooms (room_code, short_description, image_path, room_type, nightly_rate, status) VALUES (%s, %s, %s, %s, %s, %s)", (code, description, image_path or None, room_type, rate, "Phòng trống"))
            room = room_by_id(result["lastrowid"])
        else:
            rooms = read_json(ROOMS_FILE, [])
            raw = {"id": max((int(item.get("id", 0)) for item in rooms), default=0) + 1, "roomCode": code, "shortDescription": description, "imagePath": image_path, "roomType": room_type, "nightlyRate": rate, "status": "Phòng trống"}
            rooms.insert(0, raw)
            write_json(ROOMS_FILE, rooms)
            room = normalize_room(raw)
        return jsonify(message="Thêm phòng thành công.", room=room), 201
    except (ValueError, mysql.connector.Error) as error:
        return jsonify(message=str(error) or "Không thể thêm phòng."), 400


@app.put("/api/rooms/<int:room_id>")
def update_room(room_id):
    denied = require_auth()
    if denied:
        return denied
    data = request.form
    code, description, room_type, rate = read_room_fields(data)
    if not re.fullmatch(r"[A-Za-z0-9-]{1,20}", code) or not description or len(description) > 240 or not room_type or not (rate > 0 and rate < float("inf")):
        return jsonify(message="Vui lòng nhập mã phòng hợp lệ, mô tả (tối đa 240 ký tự), thể loại và giá thuê > 0."), 400
    try:
        if not find_room_type(room_type):
            raise ValueError("Loại phòng không hợp lệ.")
        image_path = save_upload()
        if db_available():
            rows = query("SELECT id, image_path FROM rooms WHERE id = %s LIMIT 1", (room_id,), fetch=True)["rows"]
            if not rows:
                return jsonify(message="Không tìm thấy phòng."), 404
            duplicates = query("SELECT id FROM rooms WHERE room_code = %s AND id <> %s LIMIT 1", (code, room_id), fetch=True)["rows"]
            if duplicates:
                raise ValueError("Mã phòng đã tồn tại.")
            query("UPDATE rooms SET room_code = %s, short_description = %s, image_path = %s, room_type = %s, nightly_rate = %s WHERE id = %s", (code, description, image_path or rows[0]["image_path"], room_type, rate, room_id))
            room = room_by_id(room_id)
        else:
            rooms = read_json(ROOMS_FILE, [])
            room = next((item for item in rooms if int(item.get("id", 0)) == room_id), None)
            if not room:
                return jsonify(message="Không tìm thấy phòng."), 404
            if any(int(item.get("id", 0)) != room_id and str(item.get("roomCode", item.get("room_code", item.get("roomNumber", "")))).casefold() == code.casefold() for item in rooms):
                raise ValueError("Mã phòng đã tồn tại.")
            room.update({"roomCode": code, "shortDescription": description, "imagePath": image_path or room.get("imagePath", room.get("image_path", "")), "roomType": room_type, "nightlyRate": rate})
            write_json(ROOMS_FILE, rooms)
            room = normalize_room(room)
        return jsonify(message="Cập nhật thông tin phòng thành công.", room=room)
    except (ValueError, mysql.connector.Error) as error:
        return jsonify(message=str(error) or "Không thể cập nhật thông tin phòng."), 400


@app.patch("/api/rooms/<int:room_id>/status")
def update_room_status(room_id):
    denied = require_auth()
    if denied:
        return denied
    data = request_data()
    requested = normalized_status(data.get("status"))
    if requested not in {"Phòng trống", "Đã thuê"}:
        return jsonify(message="Trạng thái phòng không hợp lệ."), 409
    is_check_in = requested == "Đã thuê"
    check_in = None
    check_out = None
    duration_minutes = None
    duration_seconds = None
    if is_check_in:
        try:
            check_in = datetime.fromisoformat(str(data.get("checkInAt", "")).strip())
            check_out = datetime.fromisoformat(str(data.get("checkOutAt", "")).strip())
        except ValueError:
            return jsonify(message="Vui lòng nhập giờ vào và thời gian trả phòng hợp lệ."), 400
        if check_in.tzinfo is not None:
            check_in = check_in.astimezone().replace(tzinfo=None)
        if check_out.tzinfo is not None:
            check_out = check_out.astimezone().replace(tzinfo=None)
        now = datetime.now()
        if check_in > now:
            return jsonify(message="Giờ vào không được sau thời gian hiện tại."), 400
        if check_out <= check_in:
            return jsonify(message="Thời gian trả phòng phải sau thời gian vào."), 400
        duration_seconds = int((check_out - check_in).total_seconds())
        duration_minutes = duration_seconds // 60
        if duration_minutes <= 0:
            return jsonify(message="Thời gian thuê phải lớn hơn 0 phút."), 400
        if check_out.second or check_out.microsecond or check_in.second or check_in.microsecond:
            return jsonify(message="Thời gian vào và trả phòng phải chính xác đến phút."), 400

    connection = None
    try:
        connection = db_connection()
    except mysql.connector.Error:
        pass

    if connection:
        cursor = None
        try:
            cursor = connection.cursor(dictionary=True)
            cursor.execute(
                "SELECT * FROM rooms WHERE id = %s LIMIT 1 FOR UPDATE",
                (room_id,),
            )
            room = cursor.fetchone()
            if not room:
                connection.rollback()
                return jsonify(message="Không tìm thấy phòng."), 404
            current = normalized_status(room["status"])
            if is_check_in:
                if current != "Phòng trống":
                    connection.rollback()
                    return jsonify(message="Không thể cho thuê phòng đang được sử dụng."), 409
                try:
                    rental_total = calculate_rental_total(room["nightly_rate"], duration_minutes)
                except ValueError as error:
                    connection.rollback()
                    return jsonify(message=str(error)), 400
                cursor.execute(
                    "UPDATE rooms SET status = %s, checked_in_at = %s, checked_out_at = %s, rental_duration_seconds = %s, rental_duration_minutes = %s, rental_days = NULL, rental_total = %s WHERE id = %s AND LOWER(status) IN (%s, %s)",
                    (
                        requested,
                        check_in,
                        check_out,
                        duration_seconds,
                        duration_minutes,
                        rental_total,
                        room_id,
                        "phòng trống",
                        "available",
                    ),
                )
                if not cursor.rowcount:
                    connection.rollback()
                    return jsonify(message="Không thể cho thuê phòng đang được sử dụng."), 409
                success_message = "Cho thuê phòng thành công!"
                room.update({
                    "status": requested,
                    "checked_in_at": check_in,
                    "checked_out_at": check_out,
                    "rental_duration_seconds": duration_seconds,
                    "rental_duration_minutes": duration_minutes,
                    "rental_days": None,
                    "rental_total": rental_total,
                })
            else:
                if current != "Đã thuê":
                    connection.rollback()
                    return jsonify(message="Phòng hiện không được cho thuê."), 409
                try:
                    checked_in_at = parse_datetime_value(room["checked_in_at"])
                    scheduled_check_out = parse_datetime_value(room["checked_out_at"])
                    if not checked_in_at:
                        raise ValueError
                    returned_at = datetime.now()
                    stored_minutes = max(0, int((returned_at - checked_in_at).total_seconds() // 60))
                    rental_total = calculate_rental_total(room["nightly_rate"], stored_minutes)
                except (TypeError, ValueError, InvalidOperation):
                    connection.rollback()
                    return jsonify(message="Không thể lưu lịch sử: thông tin lượt thuê hiện tại không hợp lệ."), 409
                cursor.execute(
                    "INSERT INTO rental_history (room_id, checked_in_at, scheduled_check_out_at, returned_at, duration_minutes, rental_total) VALUES (%s, %s, %s, %s, %s, %s)",
                    (room_id, checked_in_at, scheduled_check_out, returned_at, stored_minutes, rental_total),
                )
                cursor.execute(
                    "UPDATE rooms SET status = %s, checked_in_at = NULL, checked_out_at = NULL, rental_duration_seconds = NULL, rental_duration_minutes = NULL, rental_days = NULL, rental_total = NULL WHERE id = %s AND status = %s",
                    (requested, room_id, "Đã thuê"),
                )
                if not cursor.rowcount:
                    connection.rollback()
                    return jsonify(message="Không thể trả phòng do trạng thái phòng đã thay đổi."), 409
                success_message = "Trả phòng thành công!"
                room.update({
                    "status": requested,
                    "checked_in_at": None,
                    "checked_out_at": None,
                    "rental_duration_seconds": None,
                    "rental_duration_minutes": None,
                    "rental_days": None,
                    "rental_total": None,
                })
            connection.commit()
            return jsonify(message=success_message, room=normalize_room(room))
        except mysql.connector.Error as error:
            if connection:
                connection.rollback()
            return jsonify(message=str(error) or "Không thể cập nhật thông tin thuê phòng."), 500
        except OSError as error:
            if connection:
                connection.rollback()
            return jsonify(message=str(error) or "Không thể cập nhật thông tin thuê phòng."), 500
        finally:
            if cursor:
                cursor.close()
            if connection and connection.is_connected():
                connection.close()
    else:
        rooms = read_json(ROOMS_FILE, [])
        room = next((item for item in rooms if int(item.get("id", 0)) == room_id), None)
        if not room:
            return jsonify(message="Không tìm thấy phòng."), 404
        current = normalized_status(room.get("status"))
        if is_check_in:
            if current != "Phòng trống":
                return jsonify(message="Không thể cho thuê phòng đang được sử dụng."), 409
            try:
                rental_total = calculate_rental_total(
                    room.get("nightlyRate", room.get("nightly_rate", 0)), duration_minutes
                )
            except ValueError as error:
                return jsonify(message=str(error)), 400
            room["checkInAt"] = check_in.isoformat()
            room["checkOutAt"] = check_out.isoformat()
            room["rentalDurationSeconds"] = duration_seconds
            room["rentalDurationMinutes"] = duration_minutes
            room["rentalDays"] = None
            room["rentalTotal"] = float(rental_total)
            room["checked_in_at"] = check_in.isoformat()
            room["checked_out_at"] = check_out.isoformat()
            room["rental_duration_seconds"] = duration_seconds
            room["rental_duration_minutes"] = duration_minutes
            room["rental_days"] = None
            room["rental_total"] = float(rental_total)
            success_message = "Cho thuê phòng thành công!"
        else:
            if current != "Đã thuê":
                return jsonify(message="Phòng hiện không được cho thuê."), 409
            try:
                checked_in_at = parse_datetime_value(room.get("checkInAt", room.get("checked_in_at")))
                scheduled_check_out = parse_datetime_value(room.get("checkOutAt", room.get("checked_out_at")))
                if not checked_in_at:
                    raise ValueError
                returned_at = datetime.now()
                stored_minutes = max(0, int((returned_at - checked_in_at).total_seconds() // 60))
                rental_total = calculate_rental_total(
                    room.get("nightlyRate", room.get("nightly_rate", 0)), stored_minutes
                )
            except (TypeError, ValueError, InvalidOperation):
                return jsonify(message="Không thể lưu lịch sử: thông tin lượt thuê hiện tại không hợp lệ."), 409
            history = room.setdefault("rentalHistory", [])
            history.append({
                "checkedInAt": checked_in_at.isoformat(timespec="minutes"),
                "scheduledCheckOutAt": scheduled_check_out.isoformat(timespec="minutes") if scheduled_check_out else None,
                "returnedAt": returned_at.isoformat(timespec="minutes"),
                "durationMinutes": int(stored_minutes),
                "rentalTotal": float(rental_total),
            })
            room["checkInAt"] = None
            room["checkOutAt"] = None
            room["checked_in_at"] = None
            room["checked_out_at"] = None
            room["rentalDurationSeconds"] = None
            room["rentalDurationMinutes"] = None
            room["rentalDays"] = None
            room["rentalTotal"] = None
            room["rental_duration_seconds"] = None
            room["rental_duration_minutes"] = None
            room["rental_days"] = None
            room["rental_total"] = None
            success_message = "Trả phòng thành công!"
        room["status"] = requested
        try:
            write_json(ROOMS_FILE, rooms)
        except OSError as error:
            return jsonify(message=str(error) or "Không thể lưu thông tin thuê phòng."), 500
        return jsonify(message=success_message, room=normalize_room(room))
    return jsonify(message=success_message, room=room_by_id(room_id))


@app.delete("/api/rooms/<int:room_id>")
def delete_room(room_id):
    denied = require_auth()
    if denied:
        return denied
    if db_available():
        rows = query("SELECT id, status FROM rooms WHERE id = %s LIMIT 1", (room_id,), fetch=True)["rows"]
        if not rows:
            return jsonify(message="Không tìm thấy phòng cần xóa."), 404
        if str(rows[0]["status"]).casefold() in {"đã thuê", "đang thuê", "rented", "occupied"}:
            return jsonify(message="Không thể xóa phòng đang được thuê."), 409
        try:
            result = query("DELETE FROM rooms WHERE id = %s AND LOWER(status) NOT IN (%s, %s, %s, %s)", (room_id, "đã thuê", "đang thuê", "rented", "occupied"))
        except mysql.connector.Error as error:
            if error.errno == 1451:
                return jsonify(message="Không thể xóa phòng đang có dữ liệu đặt phòng."), 409
            raise
        if result["rowcount"]:
            return jsonify(message="Xóa phòng thành công.")
        return jsonify(message="Không thể xóa phòng đang được thuê."), 409
    rooms = read_json(ROOMS_FILE, [])
    index = next((i for i, room in enumerate(rooms) if int(room.get("id", 0)) == room_id), None)
    if index is None:
        return jsonify(message="Không tìm thấy phòng cần xóa."), 404
    if str(rooms[index].get("status", "")).casefold() in {"đã thuê", "đang thuê", "rented", "occupied"}:
        return jsonify(message="Không thể xóa phòng đang được thuê."), 409
    rooms.pop(index)
    write_json(ROOMS_FILE, rooms)
    return jsonify(message="Xóa phòng thành công.")


@app.get("/api/room-types")
def get_room_types():
    denied = require_auth()
    if denied:
        return denied
    try:
        types = list_room_types()
        return jsonify(roomTypes=types, nextCode=next_type_code(types))
    except mysql.connector.Error as error:
        return jsonify(message=str(error) or "Không thể tải danh sách thể loại phòng."), 500


@app.post("/api/room-types")
def add_room_type():
    denied = require_auth()
    if denied:
        return denied
    name = " ".join(str(request_data().get("name", "")).split())
    description = str(request_data().get("description", "")).strip()
    if not name:
        return jsonify(message="Tên thể loại không được để trống."), 400
    if len(description) > 500:
        return jsonify(message="Mô tả không được vượt quá 500 ký tự."), 400
    try:
        types = list_room_types()
        if any(norm_name(item["name"]) == norm_name(name) for item in types):
            return jsonify(message="Tên thể loại đã tồn tại."), 409
        code = next_type_code(types)
        if db_available():
            query("INSERT INTO room_types (code, name, description) VALUES (%s, %s, %s)", (code, name, description))
        else:
            types.append({"code": code, "name": name, "description": description})
            write_json(ROOM_TYPES_FILE, types)
        return jsonify(message="Thêm thể loại phòng thành công.", roomType={"code": code, "name": name, "description": description}), 201
    except mysql.connector.Error as error:
        status = 409 if error.errno == 1062 else 400
        return jsonify(message="Tên thể loại đã tồn tại." if status == 409 else str(error)), status


@app.put("/api/room-types/<code>")
def update_room_type(code):
    denied = require_auth()
    if denied:
        return denied
    payload = request_data()
    name = " ".join(str(payload.get("name", "")).split())
    if not name:
        return jsonify(message="Tên thể loại không được để trống."), 400
    if len(name) > 80:
        return jsonify(message="Tên thể loại không được vượt quá 80 ký tự."), 400
    try:
        types = list_room_types()
        current = next((item for item in types if item["code"] == code), None)
        if not current:
            return jsonify(message="Không tìm thấy thể loại phòng."), 404
        description = str(payload.get("description", current.get("description", "")) or "").strip()
        if len(description) > 500:
            return jsonify(message="Mô tả không được vượt quá 500 ký tự."), 400
        if any(item["code"] != code and norm_name(item["name"]) == norm_name(name) for item in types):
            return jsonify(message="Tên thể loại đã tồn tại."), 409
        if db_available():
            connection = db_connection()
            cursor = connection.cursor()
            try:
                connection.start_transaction()
                cursor.execute("SELECT code FROM room_types WHERE code = %s FOR UPDATE", (code,))
                if not cursor.fetchone():
                    connection.rollback()
                    return jsonify(message="Không tìm thấy thể loại phòng."), 404
                cursor.execute("UPDATE room_types SET name = %s, description = %s WHERE code = %s", (name, description, code))
                cursor.execute("UPDATE rooms SET room_type = %s WHERE room_type = %s", (name, current["name"]))
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                cursor.close()
                connection.close()
        else:
            for item in types:
                if item["code"] == code:
                    item["name"] = name
                    item["description"] = description
            rooms = read_json(ROOMS_FILE, [])
            for room in rooms:
                old_name = room.get("roomType", room.get("room_type", ""))
                if norm_name(old_name) == norm_name(current["name"]):
                    if "roomType" in room or "room_type" not in room:
                        room["roomType"] = name
                    if "room_type" in room:
                        room["room_type"] = name
            write_json(ROOMS_FILE, rooms)
            write_json(ROOM_TYPES_FILE, types)
        return jsonify(message="Cập nhật thể loại phòng thành công.", roomType={"code": code, "name": name, "description": description})
    except mysql.connector.Error as error:
        status = 409 if error.errno == 1062 else 400
        return jsonify(message="Tên thể loại đã tồn tại." if status == 409 else str(error)), status


@app.delete("/api/room-types/<code>")
def delete_room_type(code):
    denied = require_auth()
    if denied:
        return denied
    types = list_room_types()
    current = next((item for item in types if item["code"] == code), None)
    if not current:
        return jsonify(message="Không tìm thấy thể loại phòng."), 404
    if len(types) <= 1:
        return jsonify(message="Không thể xóa thể loại phòng cuối cùng."), 409
    if db_available():
        count = query("SELECT COUNT(*) AS total FROM rooms WHERE room_type = %s", (current["name"],), fetch=True)["rows"][0]["total"]
        if count:
            return jsonify(message="Không thể xóa thể loại đang được sử dụng bởi phòng."), 409
        query("DELETE FROM room_types WHERE code = %s", (code,))
    else:
        rooms = read_json(ROOMS_FILE, [])
        if any(norm_name(room.get("roomType", room.get("room_type"))) == norm_name(current["name"]) for room in rooms):
            return jsonify(message="Không thể xóa thể loại đang được sử dụng bởi phòng."), 409
        write_json(ROOM_TYPES_FILE, [item for item in types if item["code"] != code])
    return jsonify(message="Xóa thể loại phòng thành công.", roomType=current)


@app.get("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.get("/<path:filename>")
def frontend_file(filename):
    return send_from_directory(FRONTEND_DIR, filename)


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify(message="Tệp ảnh không được vượt quá 5MB."), 413


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    initialize_database()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "3001")), debug=False)
