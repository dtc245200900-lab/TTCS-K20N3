import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
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
ROOM_STATUSES = {"Phòng trống", "Đã đặt", "Đã thuê", "Đang dọn phòng", "Bảo trì"}
ROOM_AVAILABLE_STATUS = "Phòng trống"
ROOM_RESERVED_STATUS = "Đã đặt"
ROOM_OCCUPIED_STATUS = "Đã thuê"
ROOM_CLEANING_STATUS = "Đang dọn phòng"
ROOM_MAINTENANCE_STATUS = "Bảo trì"
BOOKING_PENDING_STATUS = "pending"
BOOKING_CHECKED_IN_STATUS = "checked_in"
BOOKING_CHECKED_OUT_STATUS = "checked_out"
BOOKING_CANCELLED_STATUS = "cancelled"
CLEANING_TIMEOUT_MINUTES = 30
BOOKINGS_FILE = DATA_DIR / "bookings.json"
CUSTOMERS_FILE = DATA_DIR / "customers.json"

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


@app.after_request
def prevent_stale_frontend_assets(response):
    if request.path == "/home" or request.path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


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
    "connection_timeout": 1,
    "connect_timeout": 1,
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
                hourly_rate DECIMAL(12,2) NULL,
                status ENUM('Phòng trống', 'Đã thuê', 'Đang dọn phòng', 'Bảo trì') NOT NULL DEFAULT 'Phòng trống',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                checked_in_at DATETIME NULL,
                checked_out_at DATETIME NULL,
                rental_duration_seconds BIGINT UNSIGNED NULL,
                rental_duration_minutes BIGINT UNSIGNED NULL,
                rental_days INT NULL,
                rental_total DECIMAL(14,2) NULL,
                last_cleaning_started_at DATETIME NULL,
                cleaning_started_at DATETIME NULL,
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
        if "last_cleaning_started_at" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN last_cleaning_started_at DATETIME NULL")
        if "cleaning_started_at" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN cleaning_started_at DATETIME NULL")
        if "hourly_rate" not in columns:
            cursor.execute("ALTER TABLE rooms ADD COLUMN hourly_rate DECIMAL(12,2) NULL AFTER nightly_rate")
        cursor.execute("ALTER TABLE rooms MODIFY room_type VARCHAR(80) NOT NULL")
        cursor.execute("ALTER TABLE rooms MODIFY status VARCHAR(30) NOT NULL DEFAULT 'Phòng trống'")
        cursor.execute("""
            UPDATE rooms SET status = CASE LOWER(status)
                WHEN 'available' THEN 'Phòng trống'
                WHEN 'reserved' THEN 'Đã đặt'
                WHEN 'occupied' THEN 'Đã thuê'
                WHEN 'maintenance' THEN 'Bảo trì'
                WHEN 'cleaning' THEN 'Đang dọn phòng'
                WHEN 'dang dọn phòng' THEN 'Đang dọn phòng'
                ELSE status END
        """)
        cursor.execute("ALTER TABLE rooms MODIFY status ENUM('Phòng trống', 'Đã đặt', 'Đã thuê', 'Đang dọn phòng', 'Bảo trì') NOT NULL DEFAULT 'Phòng trống'")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                full_name VARCHAR(150) NOT NULL,
                phone VARCHAR(30) NOT NULL,
                identity_number VARCHAR(40) NULL,
                email VARCHAR(254) NULL,
                address VARCHAR(255) NULL,
                date_of_birth DATE NULL,
                gender VARCHAR(20) NULL,
                notes TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_customers_phone (phone),
                UNIQUE KEY uq_customers_identity_number (identity_number)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        cursor.execute("SHOW COLUMNS FROM customers")
        customer_columns = {row[0] for row in cursor.fetchall()}
        if "date_of_birth" not in customer_columns:
            cursor.execute("ALTER TABLE customers ADD COLUMN date_of_birth DATE NULL")
        if "gender" not in customer_columns:
            cursor.execute("ALTER TABLE customers ADD COLUMN gender VARCHAR(20) NULL")
        if "notes" not in customer_columns:
            cursor.execute("ALTER TABLE customers ADD COLUMN notes TEXT NULL")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                room_id BIGINT UNSIGNED NOT NULL,
                customer_id BIGINT UNSIGNED NULL,
                scheduled_check_in_at DATETIME NOT NULL,
                scheduled_check_out_at DATETIME NOT NULL,
                guest_count INT UNSIGNED NOT NULL DEFAULT 1,
                notes TEXT NULL,
                status ENUM('pending', 'checked_in', 'checked_out', 'cancelled') NOT NULL DEFAULT 'pending',
                actual_check_in_at DATETIME NULL,
                actual_check_out_at DATETIME NULL,
                cleaning_until DATETIME NULL,
                duration_minutes BIGINT UNSIGNED NULL,
                rental_total DECIMAL(14,2) NULL,
                hourly_rate DECIMAL(12,2) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                cancelled_at DATETIME NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_bookings_room_status (room_id, status, scheduled_check_in_at),
                KEY idx_bookings_cleaning_until (cleaning_until),
                KEY idx_bookings_customer (customer_id),
                CONSTRAINT fk_bookings_room FOREIGN KEY (room_id) REFERENCES rooms(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        cursor.execute("SHOW COLUMNS FROM bookings")
        booking_columns = {row[0] for row in cursor.fetchall()}
        if "customer_id" not in booking_columns:
            cursor.execute("ALTER TABLE bookings ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER room_id")
            cursor.execute("ALTER TABLE bookings ADD KEY idx_bookings_customer (customer_id)")
        if "guest_count" not in booking_columns:
            cursor.execute("ALTER TABLE bookings ADD COLUMN guest_count INT UNSIGNED NOT NULL DEFAULT 1")
        if "notes" not in booking_columns:
            cursor.execute("ALTER TABLE bookings ADD COLUMN notes TEXT NULL")
        if "hourly_rate" not in booking_columns:
            cursor.execute("ALTER TABLE bookings ADD COLUMN hourly_rate DECIMAL(12,2) NULL AFTER rental_total")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS room_types (
                code VARCHAR(16) NOT NULL,
                name VARCHAR(80) NOT NULL,
                description TEXT NULL,
                nightly_rate DECIMAL(12,2) NULL,
                hourly_rate DECIMAL(12,2) NULL,
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
        if "nightly_rate" not in room_type_columns:
            cursor.execute("ALTER TABLE room_types ADD COLUMN nightly_rate DECIMAL(12,2) NULL AFTER description")
        if "hourly_rate" not in room_type_columns:
            cursor.execute("ALTER TABLE room_types ADD COLUMN hourly_rate DECIMAL(12,2) NULL AFTER nightly_rate")
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
        "email": user.get("email", ""),
        "fullName": user.get("fullName", ""),
        "dateOfBirth": user.get("dateOfBirth", ""),
        "gender": user.get("gender", ""),
        "phone": user.get("phone", ""),
        "address": user.get("address", ""),
        "avatar": user.get("avatar", ""),
        "username": user.get("username"),
    }


PASSWORD_RESET_TTL_SECONDS = 300
PASSWORD_RESET_CODES = {}


def normalize_username(value):
    return "".join(str(value or "").split()).lower()


def normalize_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) > 10 and digits.startswith("84"):
        digits = "0" + digits[2:]
    return digits


def users():
    existing = read_json(USERS_FILE, [])
    if not existing:
        password_hash = bcrypt.hashpw(b"Admin@123", bcrypt.gensalt(rounds=12)).decode("utf-8")
        existing = [{
            "id": 1,
            "email": "admin@hotel.local",
            "username": "admin",
            "phone": "0900000000",
            "passwordHash": password_hash,
            "fullName": "Quản trị viên",
        }]
        write_json(USERS_FILE, existing)
    return existing


def find_user(email):
    normalized = str(email or "").strip().lower()
    return next((user for user in users() if str(user.get("email", "")).strip().lower() == normalized), None)


def find_user_by_identifier(identifier):
    value = str(identifier or "").strip()
    if not value:
        return None
    normalized_value = value.lower()
    normalized_phone = normalize_phone(value)
    normalized_username = normalize_username(value)
    for user in users():
        if str(user.get("email", "")).strip().lower() == normalized_value:
            return user
        if normalize_username(user.get("username", "")) == normalized_username:
            return user
        if normalize_phone(user.get("phone", "")) == normalized_phone:
            return user
    return None


def normalized_status(value):
    status = str(value or "").strip().lower()
    aliases = {
        "available": ROOM_AVAILABLE_STATUS,
        "phong-trong": ROOM_AVAILABLE_STATUS,
        "phòng trống": ROOM_AVAILABLE_STATUS,
        "reserved": ROOM_RESERVED_STATUS,
        "đã đặt": ROOM_RESERVED_STATUS,
        "occupied": ROOM_OCCUPIED_STATUS,
        "rented": ROOM_OCCUPIED_STATUS,
        "đã thuê": ROOM_OCCUPIED_STATUS,
        "đã cho thuê": ROOM_OCCUPIED_STATUS,
        "đang thuê": ROOM_OCCUPIED_STATUS,
        "đang cho thuê": ROOM_OCCUPIED_STATUS,
        "cleaning": ROOM_CLEANING_STATUS,
        "dang-don-phong": ROOM_CLEANING_STATUS,
        "dang don phong": ROOM_CLEANING_STATUS,
        "đang dọn phòng": ROOM_CLEANING_STATUS,
        "đang-don-phong": ROOM_CLEANING_STATUS,
        "maintenance": ROOM_MAINTENANCE_STATUS,
        "bao-tri": ROOM_MAINTENANCE_STATUS,
        "bảo trì": ROOM_MAINTENANCE_STATUS,
    }
    return aliases.get(status, str(value or "").strip())


def normalize_booking(booking):
    if not booking:
        return None
    return {
        "id": booking.get("id"),
        "roomId": booking.get("room_id", booking.get("roomId")),
        "roomCode": booking.get("roomCode", booking.get("room_code", "")),
        "customerId": booking.get("customer_id", booking.get("customerId")),
        "customerName": booking.get("customerName", booking.get("customer_name", "")),
        "customerPhone": booking.get("customerPhone", booking.get("customer_phone", "")),
        "customerIdentity": booking.get("customerIdentity", booking.get("customer_identity", "")),
        "customerEmail": booking.get("customerEmail", booking.get("customer_email", "")),
        "guestCount": booking.get("guest_count", booking.get("guestCount", 1)),
        "notes": booking.get("notes", ""),
        "scheduledCheckInAt": iso_value(booking.get("scheduled_check_in_at", booking.get("scheduledCheckInAt"))),
        "scheduledCheckOutAt": iso_value(booking.get("scheduled_check_out_at", booking.get("scheduledCheckOutAt"))),
        "status": booking.get("status", BOOKING_PENDING_STATUS),
        "actualCheckInAt": iso_value(booking.get("actual_check_in_at", booking.get("actualCheckInAt"))),
        "actualCheckOutAt": iso_value(booking.get("actual_check_out_at", booking.get("actualCheckOutAt"))),
        "cleaningUntil": iso_value(booking.get("cleaning_until", booking.get("cleaningUntil"))),
        "durationMinutes": booking.get("duration_minutes", booking.get("durationMinutes")),
        "rentalTotal": float(booking.get("rental_total", booking.get("rentalTotal"))) if booking.get("rental_total", booking.get("rentalTotal")) is not None else None,
        "hourlyRate": float(booking.get("hourly_rate", booking.get("hourlyRate"))) if booking.get("hourly_rate", booking.get("hourlyRate")) is not None else None,
        "createdAt": iso_value(booking.get("created_at", booking.get("createdAt"))),
        "cancelledAt": iso_value(booking.get("cancelled_at", booking.get("cancelledAt"))),
        "updatedAt": iso_value(booking.get("updated_at", booking.get("updatedAt"))),
    }


def normalize_customer(customer, booking_count=0):
    if not customer:
        return None
    return {
        "id": customer.get("id"),
        "fullName": customer.get("full_name", customer.get("fullName", "")),
        "phone": customer.get("phone", ""),
        "identityNumber": customer.get("identity_number", customer.get("identityNumber", "")),
        "email": customer.get("email", ""),
        "address": customer.get("address", ""),
        "dateOfBirth": iso_value(customer.get("date_of_birth", customer.get("dateOfBirth"))),
        "gender": customer.get("gender", ""),
        "notes": customer.get("notes", ""),
        "bookingCount": booking_count,
        "createdAt": iso_value(customer.get("created_at", customer.get("createdAt"))),
    }


def apply_booking_lifecycle(booking, now=None):
    if not booking or booking.get("status") != BOOKING_PENDING_STATUS:
        return booking
    scheduled_check_in = parse_datetime_value(booking.get("scheduledCheckInAt"))
    current_time = now or datetime.now()
    if scheduled_check_in is None or scheduled_check_in > current_time:
        return booking
    booking["status"] = BOOKING_CHECKED_IN_STATUS
    booking["actualCheckInAt"] = current_time.isoformat(timespec="seconds")
    return booking


def refresh_booking_lifecycles(now=None, database_available=None):
    current_time = now or datetime.now()
    if database_available is None:
        database_available = db_available()
    if database_available:
        rows = query(
            "SELECT * FROM bookings WHERE status = %s ORDER BY id DESC",
            (BOOKING_PENDING_STATUS,),
            fetch=True,
        )["rows"]
        for row in rows:
            booking = normalize_booking(row)
            scheduled_check_in = parse_datetime_value(booking["scheduledCheckInAt"])
            if scheduled_check_in is not None and scheduled_check_in <= current_time:
                query(
                    "UPDATE bookings SET status = %s, actual_check_in_at = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                    (BOOKING_CHECKED_IN_STATUS, current_time, booking["id"]),
                )
        return

    bookings = read_json(BOOKINGS_FILE, [])
    changed = False
    for booking in bookings:
        normalized = normalize_booking(booking)
        scheduled_check_in = parse_datetime_value(normalized["scheduledCheckInAt"])
        if normalized["status"] == BOOKING_PENDING_STATUS and scheduled_check_in is not None and scheduled_check_in <= current_time:
            apply_booking_lifecycle(normalized, current_time)
            booking.update({
                "status": normalized["status"],
                "actual_check_in_at": normalized["actualCheckInAt"],
                "updated_at": current_time.isoformat(timespec="seconds"),
            })
            changed = True
    if changed:
        write_json(BOOKINGS_FILE, bookings)


def booking_rows_for_room(room_id):
    refresh_booking_lifecycles()
    if db_available():
        rows = query(
            "SELECT * FROM bookings WHERE room_id = %s ORDER BY created_at DESC, id DESC",
            (room_id,),
            fetch=True,
        )["rows"]
        return [normalize_booking(row) for row in rows]
    bookings = read_json(BOOKINGS_FILE, [])
    return [normalize_booking(row) for row in bookings if str(row.get("room_id", row.get("roomId"))) == str(room_id)]


def latest_booking_for_room(room_id, now=None):
    bookings = booking_rows_for_room(room_id)
    if not bookings:
        return None
    return max(bookings, key=lambda booking: (booking["id"] or 0))


def derived_room_status(room, booking=None, now=None):
    if normalized_status(room.get("status")) == ROOM_MAINTENANCE_STATUS:
        return ROOM_MAINTENANCE_STATUS
    if booking is None:
        return normalized_status(room.get("status"))
    if booking["status"] == BOOKING_PENDING_STATUS:
        return ROOM_RESERVED_STATUS
    if booking["status"] == BOOKING_CHECKED_IN_STATUS:
        return ROOM_OCCUPIED_STATUS
    if booking["status"] == BOOKING_CHECKED_OUT_STATUS:
        cleaning_until = parse_datetime_value(booking["cleaningUntil"])
        if cleaning_until is not None and normalize_datetime_to_minute(now or datetime.now()) >= normalize_datetime_to_minute(cleaning_until):
            return ROOM_AVAILABLE_STATUS
        return ROOM_CLEANING_STATUS
    if booking["status"] == BOOKING_CANCELLED_STATUS:
        return ROOM_AVAILABLE_STATUS
    return normalized_status(room.get("status"))


def set_room_cleaning(room):
    room["status"] = ROOM_CLEANING_STATUS
    started_at = datetime.now()
    started_at_value = started_at.isoformat(timespec="seconds")
    room["last_cleaning_started_at"] = started_at_value
    room["cleaning_started_at"] = started_at_value
    room["checked_in_at"] = None
    room["checked_out_at"] = None
    room["checkInAt"] = None
    room["checkOutAt"] = None
    room["rental_duration_seconds"] = None
    room["rental_duration_minutes"] = None
    room["rental_days"] = None
    room["rental_total"] = None
    return room


def apply_room_cleaning_transition(room):
    status = normalized_status(room.get("status"))
    if status != ROOM_OCCUPIED_STATUS:
        return room

    check_in_time = parse_datetime_value(room.get("checked_in_at", room.get("checkInAt")))
    if check_in_time is None:
        return room

    check_out_time = parse_datetime_value(room.get("checked_out_at", room.get("checkOutAt")))
    started_at = datetime.now()
    if check_out_time is not None and check_out_time > check_in_time:
        started_at = check_out_time
    room["status"] = ROOM_CLEANING_STATUS
    started_at_value = started_at.isoformat(timespec="seconds")
    room["last_cleaning_started_at"] = started_at_value
    room["cleaning_started_at"] = started_at_value
    room["checked_in_at"] = None
    room["checked_out_at"] = None
    room["checkInAt"] = None
    room["checkOutAt"] = None
    room["rental_duration_seconds"] = None
    room["rental_duration_minutes"] = None
    room["rental_days"] = None
    room["rental_total"] = None
    return room


def finalize_cleaning_rooms(rooms):
    updated = False
    for room in rooms:
        status = normalized_status(room.get("status"))
        if status != ROOM_CLEANING_STATUS:
            continue
        started_at_raw = room.get("last_cleaning_started_at") or room.get("cleaning_started_at")
        started_at = parse_datetime_value(started_at_raw)
        if started_at is None:
            room["status"] = ROOM_AVAILABLE_STATUS
            room["last_cleaning_started_at"] = None
            room["cleaning_started_at"] = None
            updated = True
            continue
        elapsed_minutes = max(0, int((datetime.now() - started_at).total_seconds() // 60))
        if elapsed_minutes >= CLEANING_TIMEOUT_MINUTES:
            room["status"] = ROOM_AVAILABLE_STATUS
            room["last_cleaning_started_at"] = None
            room["cleaning_started_at"] = None
            updated = True
    return updated


def ensure_room_cleaning_transition(room):
    status = normalized_status(room.get("status"))
    if status == ROOM_CLEANING_STATUS:
        started_at_raw = room.get("last_cleaning_started_at") or room.get("cleaning_started_at")
        started_at = parse_datetime_value(started_at_raw)
        if started_at is not None and datetime.now() >= started_at + timedelta(minutes=CLEANING_TIMEOUT_MINUTES):
            room["status"] = ROOM_AVAILABLE_STATUS
            room["last_cleaning_started_at"] = None
            room["cleaning_started_at"] = None
    return room


def current_room_rental_total(room):
    if normalized_status(room.get("status")) != "Đã thuê":
        return None

    def value(*keys):
        return next((room[key] for key in keys if room.get(key) is not None), None)

    try:
        rate = Decimal(str(room_hourly_rate(room)))
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
        return float(calculate_hourly_rental_total(rate, elapsed_minutes))
    except (InvalidOperation, TypeError, ValueError, OverflowError):
        return None


def normalize_room(room):
    if room is None:
        return None
    room = ensure_room_cleaning_transition(room)

    def get(*keys, default=None):
        for key in keys:
            if room.get(key) is not None:
                return room[key]
        return default

    rate = room_hourly_rate(room)
    if isinstance(rate, Decimal):
        rate = float(rate)
    return {
        "id": get("id"),
        "roomCode": get("room_code", "roomCode", "roomNumber", default=""),
        "shortDescription": get("short_description", "shortDescription", default=""),
        "imagePath": get("image_path", "imagePath", default=""),
        "roomType": get("room_type", "roomType", default="Đơn"),
        "hourlyRate": float(rate) if rate is not None else None,
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


def normalize_datetime_to_minute(value):
    return value.replace(second=0, microsecond=0)


def validate_booking_window(check_in, check_out, now=None):
    if isinstance(check_in, str):
        check_in = parse_datetime_value(check_in)
    if isinstance(check_out, str):
        check_out = parse_datetime_value(check_out)
    if check_in is None or check_out is None:
        raise ValueError("Vui lòng chọn thời gian nhận phòng và trả phòng hợp lệ.")
    if check_in.tzinfo is not None:
        check_in = check_in.astimezone().replace(tzinfo=None)
    if check_out.tzinfo is not None:
        check_out = check_out.astimezone().replace(tzinfo=None)
    check_in = normalize_datetime_to_minute(check_in)
    check_out = normalize_datetime_to_minute(check_out)
    if now is None:
        now = datetime.now()
    if now.tzinfo is not None:
        now = now.astimezone().replace(tzinfo=None)
    now = normalize_datetime_to_minute(now)
    if check_in < now:
        raise ValueError("Thời gian nhận phòng không được ở quá khứ. Vui lòng chọn thời điểm hiện tại hoặc thời gian trong tương lai.")
    if check_out <= check_in:
        raise ValueError("Giờ trả phòng phải sau giờ nhận phòng.")
    return check_in, check_out


def booking_conflicts(existing_bookings, check_in, check_out, now=None):
    try:
        start, end = validate_booking_window(check_in, check_out, now=now)
    except ValueError:
        return True

    for booking in existing_bookings or []:
        if isinstance(booking, dict):
            booking_start = booking.get("check_in") or booking.get("checkInAt") or booking.get("checked_in_at") or booking.get("start")
            booking_end = booking.get("check_out") or booking.get("checkOutAt") or booking.get("checked_out_at") or booking.get("end")
        elif isinstance(booking, (tuple, list)) and len(booking) >= 2:
            booking_start, booking_end = booking[0], booking[1]
        else:
            continue
        if booking_start is None or booking_end is None:
            continue
        booking_start = parse_datetime_value(booking_start)
        booking_end = parse_datetime_value(booking_end)
        if booking_start is None or booking_end is None:
            continue
        if booking_start.tzinfo is not None:
            booking_start = booking_start.astimezone().replace(tzinfo=None)
        if booking_end.tzinfo is not None:
            booking_end = booking_end.astimezone().replace(tzinfo=None)
        if start < booking_end and end > booking_start:
            return True
    return False


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


def calculate_hourly_rental_total(hourly_rate, duration_minutes):
    try:
        rate = Decimal(str(hourly_rate))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Giá phòng theo giờ không hợp lệ.")
    if not rate.is_finite() or rate <= 0:
        raise ValueError("Giá phòng theo giờ không hợp lệ.")
    if duration_minutes <= 0:
        raise ValueError("Thời gian thuê phải lớn hơn 0 phút.")
    billable_hours = (Decimal(duration_minutes) / Decimal(60)).to_integral_value(rounding=ROUND_CEILING)
    return (rate * billable_hours).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def norm_name(value):
    return " ".join(str(value or "").split()).casefold()


def next_type_code(room_types):
    highest = 0
    for room_type in room_types:
        match = re.fullmatch(r"LP(\d+)", str(room_type.get("code", "")), re.IGNORECASE)
        if match:
            highest = max(highest, int(match.group(1)))
    return f"LP{highest + 1:03d}"


def normalize_room_type(room_type):
    rate = room_type.get("hourly_rate", room_type.get("hourlyRate"))
    return {
        "code": room_type["code"],
        "name": room_type["name"],
        "description": room_type.get("description") or "",
        "hourlyRate": float(rate) if rate is not None else None,
    }


def parse_room_type_rate(value):
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Vui lòng nhập giá theo giờ hợp lệ cho thể loại phòng.")
    if (
        not rate.is_finite()
        or rate <= 0
        or rate > Decimal("9999999999.99")
        or rate != rate.quantize(Decimal("0.01"))
    ):
        raise ValueError("Giá theo giờ phải lớn hơn 0 và không vượt quá 9.999.999.999,99 VNĐ.")
    return rate


def room_hourly_rate(room):
    if not room:
        return None
    for key in ("hourly_rate", "hourlyRate", "type_hourly_rate"):
        value = room.get(key)
        if value is not None:
            return float(value)

    room_type_name = room.get("room_type", room.get("roomType", ""))
    if db_available():
        rows = query(
            "SELECT hourly_rate FROM room_types WHERE name = %s LIMIT 1",
            (room_type_name,),
            fetch=True,
        )["rows"]
        return float(rows[0]["hourly_rate"]) if rows and rows[0].get("hourly_rate") is not None else None

    room_type = next(
        (
            item for item in read_json(ROOM_TYPES_FILE, [])
            if norm_name(item.get("name")) == norm_name(room_type_name)
        ),
        None,
    )
    value = room_type.get("hourlyRate", room_type.get("hourly_rate")) if room_type else None
    return float(value) if value is not None else None


def list_room_types():
    if db_available():
        room_rows = query("SELECT DISTINCT room_type FROM rooms", fetch=True)["rows"]
        type_rows = query("SELECT code, name, description, hourly_rate FROM room_types ORDER BY code", fetch=True)["rows"]
        types = [normalize_room_type(row) for row in type_rows]
        if not type_rows and not room_rows:
            json_types = read_json(ROOM_TYPES_FILE, [])
            if json_types:
                return [normalize_room_type(room_type) for room_type in json_types]
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
        rows = query("SELECT code, name, description, hourly_rate FROM room_types ORDER BY code", fetch=True)["rows"]
        if rows:
            return [normalize_room_type(row) for row in rows]

    types = read_json(ROOM_TYPES_FILE, [])
    rooms = read_json(ROOMS_FILE, [])
    if not types and not rooms:
        types = [{"code": "LP001", "name": "Đơn", "description": ""}, {"code": "LP002", "name": "Đôi", "description": ""}, {"code": "LP003", "name": "VIP", "description": ""}]
        write_json(ROOM_TYPES_FILE, types)
        return [normalize_room_type(room_type) for room_type in types]
    names = ([] if types else ["Đơn", "Đôi", "VIP"])
    names.extend(room.get("roomType", room.get("room_type")) for room in rooms)
    for name in names:
        if not str(name or "").strip() or any(norm_name(item.get("name")) == norm_name(name) for item in types):
            continue
        types.append({"code": next_type_code(types), "name": str(name).strip(), "description": ""})
    write_json(ROOM_TYPES_FILE, types)
    return [normalize_room_type(room_type) for room_type in types]


def find_room_type(name):
    target = norm_name(name)
    return next((item for item in list_room_types() if norm_name(item["name"]) == target), None)


def list_rooms():
    database_available = db_available()
    refresh_booking_lifecycles(database_available=database_available)
    if database_available:
        rows = query(
            """
            SELECT rooms.*, room_types.hourly_rate AS type_hourly_rate
            FROM rooms
            LEFT JOIN room_types ON room_types.name = rooms.room_type
            ORDER BY rooms.created_at DESC, rooms.id DESC
            """,
            fetch=True,
        )["rows"]
        if rows:
            booking_rows = query(
                """
                SELECT bookings.*
                FROM bookings
                INNER JOIN (
                    SELECT room_id, MAX(id) AS id
                    FROM bookings
                    GROUP BY room_id
                ) latest ON latest.id = bookings.id
                """,
                fetch=True,
            )["rows"]
            latest_bookings = latest_bookings_by_room(booking_rows)
            missing_room_ids = {str(room["id"]) for room in rows}.difference(latest_bookings)
            if missing_room_ids:
                json_bookings = latest_bookings_by_room(read_json(BOOKINGS_FILE, []))
                for room_id in missing_room_ids:
                    if room_id in json_bookings:
                        latest_bookings[room_id] = json_bookings[room_id]
            return [
                normalize_room(derive_room_with_booking(room, latest_bookings.get(str(room["id"])), lookup_booking=False))
                for room in rows
            ]
        rows = read_json(ROOMS_FILE, [])
    else:
        rows = read_json(ROOMS_FILE, [])

    latest_bookings = latest_bookings_by_room(read_json(BOOKINGS_FILE, []))
    return [
        normalize_room(derive_room_with_booking(room, latest_bookings.get(str(room["id"])), lookup_booking=False))
        for room in rows
    ]


def latest_bookings_by_room(bookings):
    latest = {}
    for row in bookings:
        booking = normalize_booking(row)
        room_id = booking["roomId"]
        if room_id is None:
            continue
        key = str(room_id)
        current = latest.get(key)
        if current is None or (booking["id"] or 0) > (current["id"] or 0):
            latest[key] = booking
    return latest


def derive_room_with_booking(room, booking=None, *, lookup_booking=True):
    if lookup_booking:
        booking = latest_booking_for_room(room["id"])
    room = dict(room)
    room["status"] = derived_room_status(room, booking)
    room["bookingId"] = booking["id"] if booking else None
    room["bookingStatus"] = booking["status"] if booking else None
    room["cleaningUntil"] = booking["cleaningUntil"] if booking else None
    if booking and booking["status"] == BOOKING_CHECKED_IN_STATUS:
        room["checked_in_at"] = booking["actualCheckInAt"]
        room["checkInAt"] = booking["actualCheckInAt"]
        room["checked_out_at"] = booking["scheduledCheckOutAt"]
        room["checkOutAt"] = booking["scheduledCheckOutAt"]
        room["rental_duration_minutes"] = None
        room["rental_total"] = None
    return room


def save_booking(booking):
    bookings = read_json(BOOKINGS_FILE, [])
    existing = next((item for item in bookings if str(item.get("id")) == str(booking["id"])), None)
    if existing:
        existing.update(booking)
    else:
        bookings.insert(0, booking)
    write_json(BOOKINGS_FILE, bookings)


@app.get("/api/rooms")
def rooms_api():
    denied = require_auth()
    if denied:
        return denied
    return jsonify(rooms=list_rooms())


def room_by_id(room_id):
    refresh_booking_lifecycles()
    if db_available():
        rows = query(
            """
            SELECT rooms.*, room_types.hourly_rate AS type_hourly_rate
            FROM rooms
            LEFT JOIN room_types ON room_types.name = rooms.room_type
            WHERE rooms.id = %s LIMIT 1
            """,
            (room_id,),
            fetch=True,
        )["rows"]
        if rows:
            return normalize_room(derive_room_with_booking(rows[0]))
        json_rows = read_json(ROOMS_FILE, [])
        room = next((item for item in json_rows if str(item.get("id")) == str(room_id)), None)
        return normalize_room(derive_room_with_booking(room)) if room else None
    rows = read_json(ROOMS_FILE, [])
    room = next((item for item in rows if str(item.get("id")) == str(room_id)), None)
    return normalize_room(derive_room_with_booking(room)) if room else None


def require_auth():
    if not session.get("user"):
        return jsonify(message="Bạn cần đăng nhập để tiếp tục."), 401
    return None


def request_data():
    return request.get_json(silent=True) or request.form


def booking_exists_conflict(room_id, check_in, check_out, exclude_id=None):
    if db_available():
        sql = """
            SELECT id FROM bookings
            WHERE room_id = %s AND status IN (%s, %s, %s)
              AND scheduled_check_in_at < %s AND scheduled_check_out_at > %s
        """
        params = (room_id, BOOKING_PENDING_STATUS, BOOKING_CHECKED_IN_STATUS, BOOKING_CHECKED_OUT_STATUS, check_out, check_in)
        if exclude_id is not None:
            sql += " AND id <> %s"
            params += (exclude_id,)
        rows = query(sql, params, fetch=True)["rows"]
        return bool(rows)
    bookings = booking_rows_for_room(room_id)
    return any(
        booking["status"] in {BOOKING_PENDING_STATUS, BOOKING_CHECKED_IN_STATUS, BOOKING_CHECKED_OUT_STATUS}
        and booking["id"] != exclude_id
        and parse_datetime_value(booking["scheduledCheckInAt"]) < check_out
        and parse_datetime_value(booking["scheduledCheckOutAt"]) > check_in
        for booking in bookings
    )


@app.get("/api/customers")
def list_customers_api():
    denied = require_auth()
    if denied:
        return denied
    if db_available():
        rows = query(
            """
            SELECT c.*, COUNT(b.id) AS booking_count
            FROM customers c
            LEFT JOIN bookings b ON b.customer_id = c.id
            GROUP BY c.id
            ORDER BY c.full_name ASC, c.id DESC
            """,
            fetch=True,
        )["rows"]
        return jsonify(customers=[
            normalize_customer(row, row.get("booking_count", 0)) for row in rows
        ])

    customers = read_json(CUSTOMERS_FILE, [])
    bookings = read_json(BOOKINGS_FILE, [])
    booking_counts = {}
    for booking in bookings:
        customer_id = booking.get("customer_id", booking.get("customerId"))
        if customer_id is not None:
            booking_counts[str(customer_id)] = booking_counts.get(str(customer_id), 0) + 1
    return jsonify(customers=[
        normalize_customer(customer, booking_counts.get(str(customer.get("id")), 0))
        for customer in customers
    ])


@app.post("/api/customers")
def create_customer_api():
    denied = require_auth()
    if denied:
        return denied
    data = request_data()
    full_name = re.sub(r"\s+", " ", str(data.get("fullName", data.get("full_name", ""))).strip())
    phone = re.sub(r"\s+", "", str(data.get("phone", "")).strip())
    identity_number = str(data.get("identityNumber", data.get("identity_number", ""))).strip() or None
    email = str(data.get("email", "")).strip() or None
    address = re.sub(r"\s+", " ", str(data.get("address", "")).strip()) or None
    date_of_birth = str(data.get("dateOfBirth", data.get("date_of_birth", ""))).strip() or None
    gender = str(data.get("gender", "")).strip() or None
    notes = str(data.get("notes", "")).strip()
    if not full_name or len(full_name) > 150:
        return jsonify(message="Vui lòng nhập họ tên khách hàng hợp lệ."), 400
    if not re.fullmatch(r"[+0-9() -]{7,30}", phone):
        return jsonify(message="Vui lòng nhập số điện thoại hợp lệ."), 400
    if identity_number and len(identity_number) > 40:
        return jsonify(message="Số CCCD/CMND không được vượt quá 40 ký tự."), 400
    if email and (len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
        return jsonify(message="Vui lòng nhập email hợp lệ."), 400
    if address and len(address) > 255:
        return jsonify(message="Địa chỉ không được vượt quá 255 ký tự."), 400
    if date_of_birth:
        try:
            if datetime.strptime(date_of_birth, "%Y-%m-%d").date() > date.today():
                raise ValueError
        except ValueError:
            return jsonify(message="Vui lòng nhập ngày sinh hợp lệ, không ở trong tương lai."), 400
    if gender and gender not in {"female", "male", "other"}:
        return jsonify(message="Vui lòng chọn giới tính hợp lệ."), 400
    if len(notes) > 1000:
        return jsonify(message="Ghi chú không được vượt quá 1000 ký tự."), 400

    if db_available():
        try:
            cursor = query(
                """
                INSERT INTO customers
                    (full_name, phone, identity_number, email, address, date_of_birth, gender, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (full_name, phone, identity_number, email, address, date_of_birth, gender, notes or None),
            )
            customer = query(
                "SELECT * FROM customers WHERE id = %s",
                (cursor["lastrowid"],),
                fetch=True,
            )["rows"][0]
            return jsonify(message="Đã thêm khách hàng.", customer=normalize_customer(customer)), 201
        except mysql.connector.IntegrityError:
            return jsonify(message="Số điện thoại hoặc CCCD/CMND đã được sử dụng."), 409
        except mysql.connector.Error as error:
            return jsonify(message=str(error) or "Không thể thêm khách hàng."), 500

    customers = read_json(CUSTOMERS_FILE, [])
    if any(
        str(customer.get("phone", "")).strip() == phone
        or (identity_number and str(customer.get("identityNumber", customer.get("identity_number", ""))).strip() == identity_number)
        for customer in customers
    ):
        return jsonify(message="Số điện thoại hoặc CCCD/CMND đã được sử dụng."), 409
    customer = {
        "id": max((int(item.get("id", 0)) for item in customers), default=0) + 1,
        "fullName": full_name,
        "phone": phone,
        "identityNumber": identity_number or "",
        "email": email or "",
        "address": address or "",
        "dateOfBirth": date_of_birth or "",
        "gender": gender or "",
        "notes": notes,
        "createdAt": datetime.now().isoformat(),
    }
    customers.append(customer)
    write_json(CUSTOMERS_FILE, customers)
    return jsonify(message="Đã thêm khách hàng.", customer=normalize_customer(customer)), 201


@app.get("/api/bookings")
def list_bookings_api():
    denied = require_auth()
    if denied:
        return denied
    refresh_booking_lifecycles()
    room_id = request.args.get("roomId") or request.args.get("room_id")
    if room_id is not None:
        return jsonify(bookings=booking_rows_for_room(int(room_id)))
    if db_available():
        rows = query(
            """
            SELECT b.*, r.room_code, c.full_name AS customer_name,
                c.phone AS customer_phone, c.identity_number AS customer_identity,
                c.email AS customer_email
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            LEFT JOIN customers c ON c.id = b.customer_id
            ORDER BY b.scheduled_check_in_at ASC, b.id DESC
            """,
            fetch=True,
        )["rows"]
        return jsonify(bookings=[normalize_booking(row) | {"roomCode": row.get("room_code")} for row in rows])
    customers_by_id = {
        str(customer.get("id")): customer for customer in read_json(CUSTOMERS_FILE, [])
    }
    room_codes_by_id = {
        str(room.get("id")): room.get("roomCode", room.get("room_code", room.get("roomNumber", "")))
        for room in read_json(ROOMS_FILE, [])
    }
    bookings = []
    for row in read_json(BOOKINGS_FILE, []):
        customer_id = row.get("customer_id", row.get("customerId"))
        customer = customers_by_id.get(str(customer_id))
        booking = normalize_booking(row)
        booking["roomCode"] = booking["roomCode"] or room_codes_by_id.get(str(booking["roomId"]), "")
        if customer:
            booking.update({
                "customerName": customer.get("fullName", customer.get("full_name", "")),
                "customerPhone": customer.get("phone", ""),
                "customerIdentity": customer.get("identityNumber", customer.get("identity_number", "")),
                "customerEmail": customer.get("email", ""),
            })
        bookings.append(booking)
    return jsonify(bookings=bookings)


@app.post("/api/bookings")
def create_booking_api():
    denied = require_auth()
    if denied:
        return denied
    data = request_data()
    try:
        room_id = int(data.get("roomId", data.get("room_id")))
        check_in, check_out = validate_booking_window(data.get("checkInAt", data.get("check_in_at")), data.get("checkOutAt", data.get("check_out_at")))
        customer_id = int(data["customerId"]) if data.get("customerId") not in (None, "") else None
        guest_count = int(data.get("guestCount", 1))
    except (TypeError, ValueError, OverflowError):
        return jsonify(message="Vui lòng chọn thời gian nhận phòng và trả phòng hợp lệ."), 400
    if guest_count < 1 or guest_count > 20:
        return jsonify(message="Số khách phải từ 1 đến 20."), 400
    notes = re.sub(r"\s+", " ", str(data.get("notes", "")).strip()) or None
    if notes and len(notes) > 1000:
        return jsonify(message="Ghi chú không được vượt quá 1000 ký tự."), 400
    if booking_exists_conflict(room_id, check_in, check_out):
        return jsonify(message="Phòng đã được đặt trong khung thời gian này. Vui lòng chọn thời gian khác."), 409
    if db_available():
        cursor = None
        connection = None
        try:
            connection = db_connection()
            cursor = connection.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT rooms.id, rooms.room_code, rooms.status,
                    COALESCE(rooms.hourly_rate, room_types.hourly_rate) AS hourly_rate
                FROM rooms
                LEFT JOIN room_types ON room_types.name = rooms.room_type
                WHERE rooms.id = %s FOR UPDATE
                """,
                (room_id,),
            )
            room = cursor.fetchone()
            if not room:
                return jsonify(message="Không tìm thấy phòng."), 404
            if room.get("hourly_rate") is None or Decimal(str(room["hourly_rate"])) <= 0:
                return jsonify(message="Thể loại phòng chưa được thiết lập giá theo giờ."), 400
            if customer_id is not None:
                cursor.execute("SELECT id FROM customers WHERE id = %s", (customer_id,))
                if not cursor.fetchone():
                    return jsonify(message="Không tìm thấy khách hàng đã chọn."), 404
            if normalized_status(room["status"]) == ROOM_MAINTENANCE_STATUS:
                return jsonify(message="Phòng đang bảo trì, không thể đặt."), 409
            if booking_exists_conflict(room_id, check_in, check_out):
                return jsonify(message="Phòng đã được đặt trong khung thời gian này. Vui lòng chọn thời gian khác."), 409
            cursor.execute(
                """
                INSERT INTO bookings (room_id, customer_id, scheduled_check_in_at,
                    scheduled_check_out_at, guest_count, notes, status, hourly_rate)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (room_id, customer_id, check_in, check_out, guest_count, notes, BOOKING_PENDING_STATUS, room["hourly_rate"]),
            )
            booking_id = cursor.lastrowid
            connection.commit()
            booking_row = query(
                """
                SELECT b.*, c.full_name AS customer_name, c.phone AS customer_phone,
                    c.identity_number AS customer_identity, c.email AS customer_email
                FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
                WHERE b.id = %s
                """,
                (booking_id,),
                fetch=True,
            )["rows"][0]
            booking = normalize_booking(booking_row)
            room_data = normalize_room(room_by_id(room_id))
            return jsonify(message="Đặt phòng thành công.", booking=booking, room=room_data), 201
        except mysql.connector.Error as error:
            if connection:
                connection.rollback()
            return jsonify(message=str(error) or "Không thể đặt phòng."), 500
        finally:
            if cursor:
                cursor.close()
            if connection and connection.is_connected():
                connection.close()
    room = next((item for item in read_json(ROOMS_FILE, []) if str(item.get("id")) == str(room_id)), None)
    if not room:
        return jsonify(message="Không tìm thấy phòng."), 404
    hourly_rate = room_hourly_rate(room)
    if hourly_rate is None or hourly_rate <= 0:
        return jsonify(message="Thể loại phòng chưa được thiết lập giá theo giờ."), 400
    customer = next(
        (item for item in read_json(CUSTOMERS_FILE, []) if str(item.get("id")) == str(customer_id)),
        None,
    ) if customer_id is not None else None
    if customer_id is not None and customer is None:
        return jsonify(message="Không tìm thấy khách hàng đã chọn."), 404
    booking = {
        "id": max((int(item.get("id", 0)) for item in read_json(BOOKINGS_FILE, [])), default=0) + 1,
        "room_id": room_id,
        "customer_id": customer_id,
        "scheduled_check_in_at": check_in.isoformat(),
        "scheduled_check_out_at": check_out.isoformat(),
        "guest_count": guest_count,
        "notes": notes or "",
        "status": BOOKING_PENDING_STATUS,
        "actual_check_in_at": None,
        "actual_check_out_at": None,
        "cleaning_until": None,
        "duration_minutes": None,
        "rental_total": None,
        "hourly_rate": hourly_rate,
        "created_at": datetime.now().isoformat(),
        "cancelled_at": None,
        "updated_at": datetime.now().isoformat(),
    }
    save_booking(booking)
    normalized_booking = normalize_booking(booking)
    if customer:
        normalized_booking.update({
            "customerName": customer.get("fullName", customer.get("full_name", "")),
            "customerPhone": customer.get("phone", ""),
            "customerIdentity": customer.get("identityNumber", customer.get("identity_number", "")),
            "customerEmail": customer.get("email", ""),
        })
    return jsonify(message="Đặt phòng thành công.", booking=normalized_booking, room=normalize_room(derive_room_with_booking(room))), 201


@app.patch("/api/bookings/<int:booking_id>/check-in")
def check_in_booking_api(booking_id):
    denied = require_auth()
    if denied:
        return denied
    now = datetime.now()
    if db_available():
        connection = None
        cursor = None
        try:
            connection = db_connection()
            cursor = connection.cursor(dictionary=True)
            cursor.execute("SELECT * FROM bookings WHERE id = %s FOR UPDATE", (booking_id,))
            booking = cursor.fetchone()
            if not booking:
                return jsonify(message="Không tìm thấy đặt phòng."), 404
            if booking["status"] != BOOKING_PENDING_STATUS:
                return jsonify(message="Đặt phòng không còn mở để kiểm tra vào."), 409
            if parse_datetime_value(booking["scheduled_check_in_at"]) > now:
                return jsonify(message="Chưa đến thời điểm nhận phòng."), 409
            cursor.execute("UPDATE bookings SET status = %s, actual_check_in_at = %s, duration_minutes = NULL, rental_total = NULL WHERE id = %s", (
                BOOKING_CHECKED_IN_STATUS,
                now,
                booking_id,
            ))
            connection.commit()
            return jsonify(message="Khách đã kiểm tra vào.", booking=normalize_booking(query("SELECT * FROM bookings WHERE id = %s", (booking_id,), fetch=True)["rows"][0]))
        except (mysql.connector.Error, ValueError, TypeError) as error:
            if connection:
                connection.rollback()
            return jsonify(message=str(error) or "Không thể kiểm tra vào."), 500
        finally:
            if cursor:
                cursor.close()
            if connection and connection.is_connected():
                connection.close()
    booking = next((item for item in read_json(BOOKINGS_FILE, []) if str(item.get("id")) == str(booking_id)), None)
    if not booking:
        return jsonify(message="Không tìm thấy đặt phòng."), 404
    booking.update({"status": BOOKING_CHECKED_IN_STATUS, "actual_check_in_at": now.isoformat(), "updated_at": now.isoformat()})
    save_booking(booking)
    return jsonify(message="Khách đã kiểm tra vào.", booking=normalize_booking(booking))


@app.patch("/api/bookings/<int:booking_id>/check-out")
def check_out_booking_api(booking_id):
    denied = require_auth()
    if denied:
        return denied
    now = datetime.now()
    if db_available():
        connection = None
        cursor = None
        try:
            connection = db_connection()
            cursor = connection.cursor(dictionary=True)
            cursor.execute("SELECT * FROM bookings WHERE id = %s FOR UPDATE", (booking_id,))
            booking = cursor.fetchone()
            if not booking:
                return jsonify(message="Không tìm thấy đặt phòng."), 404
            if booking["status"] != BOOKING_CHECKED_IN_STATUS:
                return jsonify(message="Đặt phòng không còn đang được thuê."), 409
            room = room_by_id(booking["room_id"])
            duration = max(0, math.ceil((now - parse_datetime_value(booking["actual_check_in_at"])).total_seconds() / 60))
            hourly_rate = booking.get("hourly_rate") or room.get("hourlyRate")
            total = calculate_hourly_rental_total(hourly_rate, duration)
            cleaning_until = now + timedelta(minutes=CLEANING_TIMEOUT_MINUTES)
            cursor.execute("INSERT INTO rental_history (room_id, checked_in_at, scheduled_check_out_at, returned_at, duration_minutes, rental_total) VALUES (%s, %s, %s, %s, %s, %s)", (
                booking["room_id"], booking["actual_check_in_at"], booking["scheduled_check_out_at"], now, duration, total,
            ))
            cursor.execute("UPDATE bookings SET status = %s, actual_check_out_at = %s, cleaning_until = %s, duration_minutes = %s, rental_total = %s WHERE id = %s", (
                BOOKING_CHECKED_OUT_STATUS, now, cleaning_until, duration, total, booking_id,
            ))
            connection.commit()
            updated = normalize_booking(query("SELECT * FROM bookings WHERE id = %s", (booking_id,), fetch=True)["rows"][0])
            return jsonify(message="Trả phòng thành công. Đang dọn phòng trong 30 phút.", booking=updated, room=normalize_room(room_by_id(booking["room_id"])))
        except (mysql.connector.Error, ValueError, TypeError) as error:
            if connection:
                connection.rollback()
            return jsonify(message=str(error) or "Không thể trả phòng."), 500
        finally:
            if cursor:
                cursor.close()
            if connection and connection.is_connected():
                connection.close()
    booking = next((item for item in read_json(BOOKINGS_FILE, []) if str(item.get("id")) == str(booking_id)), None)
    if not booking:
        return jsonify(message="Không tìm thấy đặt phòng."), 404
    room = next((item for item in read_json(ROOMS_FILE, []) if str(item.get("id")) == str(booking["room_id"])), None)
    duration = max(0, math.ceil((now - parse_datetime_value(booking["actual_check_in_at"])).total_seconds() / 60))
    hourly_rate = booking.get("hourly_rate") or room_hourly_rate(room)
    total = calculate_hourly_rental_total(hourly_rate, duration)
    booking.update({"status": BOOKING_CHECKED_OUT_STATUS, "actual_check_out_at": now.isoformat(), "cleaning_until": (now + timedelta(minutes=CLEANING_TIMEOUT_MINUTES)).isoformat(), "duration_minutes": duration, "rental_total": float(total), "updated_at": now.isoformat()})
    save_booking(booking)
    return jsonify(message="Trả phòng thành công. Đang dọn phòng trong 30 phút.", booking=normalize_booking(booking), room=normalize_room(derive_room_with_booking(room)))


@app.patch("/api/bookings/<int:booking_id>/cancel")
def cancel_booking_api(booking_id):
    denied = require_auth()
    if denied:
        return denied
    if db_available():
        connection = None
        cursor = None
        try:
            connection = db_connection()
            cursor = connection.cursor(dictionary=True)
            cursor.execute("SELECT * FROM bookings WHERE id = %s FOR UPDATE", (booking_id,))
            booking = cursor.fetchone()
            if not booking:
                return jsonify(message="Không tìm thấy đặt phòng."), 404
            if booking["status"] not in {BOOKING_PENDING_STATUS, BOOKING_CHECKED_IN_STATUS}:
                return jsonify(message="Đặt phòng đã kết thúc hoặc đã hủy."), 409
            cancelled_at = datetime.now()
            cursor.execute("UPDATE bookings SET status = %s, cancelled_at = %s WHERE id = %s", (BOOKING_CANCELLED_STATUS, cancelled_at, booking_id))
            connection.commit()
            return jsonify(message="Đặt phòng đã hủy.", booking=normalize_booking(query("SELECT * FROM bookings WHERE id = %s", (booking_id,), fetch=True)["rows"][0]))
        except mysql.connector.Error as error:
            if connection:
                connection.rollback()
            return jsonify(message=str(error) or "Không thể hủy đặt phòng."), 500
        finally:
            if cursor:
                cursor.close()
            if connection and connection.is_connected():
                connection.close()
    booking = next((item for item in read_json(BOOKINGS_FILE, []) if str(item.get("id")) == str(booking_id)), None)
    if not booking:
        return jsonify(message="Không tìm thấy đặt phòng."), 404
    if booking["status"] not in {BOOKING_PENDING_STATUS, BOOKING_CHECKED_IN_STATUS}:
        return jsonify(message="Đặt phòng đã kết thúc hoặc đã hủy."), 409
    booking.update({"status": BOOKING_CANCELLED_STATUS, "cancelled_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()})
    save_booking(booking)
    return jsonify(message="Đặt phòng đã hủy.", booking=normalize_booking(booking))


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
    username = normalize_username(request.form.get("username", ""))
    email = str(request.form.get("email", "")).strip().lower()
    date_of_birth = str(request.form.get("dateOfBirth", "")).strip()
    gender = str(request.form.get("gender", "")).strip()
    phone = str(request.form.get("phone", "")).strip()
    address = str(request.form.get("address", "")).strip()
    if not 2 <= len(full_name) <= 150:
        return jsonify(message="Họ và tên phải có từ 2 đến 150 ký tự."), 400
    if not 3 <= len(username) <= 50:
        return jsonify(message="Tên đăng nhập phải có từ 3 đến 50 ký tự."), 400
    if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify(message="Vui lòng nhập địa chỉ email hợp lệ."), 400
    try:
        parsed_date = datetime.strptime(date_of_birth, "%Y-%m-%d").date()
        if parsed_date > date.today():
            raise ValueError
    except ValueError:
        return jsonify(message="Vui lòng nhập ngày sinh hợp lệ, không ở trong tương lai."), 400
    if gender not in {"", "female", "male", "other"}:
        return jsonify(message="Vui lòng chọn giới tính hợp lệ."), 400
    digits = re.sub(r"\D", "", phone)
    if not re.fullmatch(r"[+0-9() -]{7,20}", phone) or not 7 <= len(digits) <= 15:
        return jsonify(message="Vui lòng nhập số điện thoại hợp lệ."), 400
    if len(address) > 255:
        return jsonify(message="Địa chỉ không được vượt quá 255 ký tự."), 400

    all_users = users()
    current_user = session["user"]
    user = next((item for item in all_users if str(item.get("id")) == str(current_user.get("id"))), None)
    if not user:
        return jsonify(message="Không tìm thấy tài khoản người dùng."), 404
    normalized_phone = normalize_phone(phone)
    if any(
        str(item.get("id")) != str(user.get("id"))
        and normalize_phone(item.get("phone", "")) == normalized_phone
        for item in all_users
    ):
        return jsonify(message="Số điện thoại này đã được sử dụng."), 409
    if any(
        str(item.get("id")) != str(user.get("id"))
        and normalize_username(item.get("username", "")) == username
        for item in all_users
    ):
        return jsonify(message="Tên đăng nhập này đã được sử dụng."), 409
    if any(
        str(item.get("id")) != str(user.get("id"))
        and str(item.get("email", "")).strip().lower() == email
        for item in all_users
    ):
        return jsonify(message="Email này đã được sử dụng."), 409

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

    user.update(
        fullName=full_name,
        username=username,
        email=email,
        dateOfBirth=date_of_birth,
        gender=gender,
        phone=phone,
        address=address,
    )
    write_json(USERS_FILE, all_users)
    session["user"] = public_user(user)
    return jsonify(message="Cập nhật thông tin cá nhân thành công", user=session["user"])


@app.put("/api/change-password")
def change_password():
    denied = require_auth()
    if denied:
        return denied

    payload = request_data()
    current_password = str(payload.get("currentPassword", ""))
    new_password = str(payload.get("newPassword", ""))
    confirm_password = str(payload.get("confirmPassword", ""))
    if not current_password:
        return jsonify(message="Vui lòng nhập mật khẩu hiện tại."), 400
    if len(new_password) < 8:
        return jsonify(message="Mật khẩu mới phải có ít nhất 8 ký tự."), 400
    if len(new_password.encode("utf-8")) > 72:
        return jsonify(message="Mật khẩu mới không được vượt quá 72 byte."), 400
    if new_password != confirm_password:
        return jsonify(message="Mật khẩu xác nhận không trùng khớp."), 400

    all_users = users()
    current_user = session["user"]
    user = next((item for item in all_users if str(item.get("id")) == str(current_user.get("id"))), None)
    if not user:
        return jsonify(message="Không tìm thấy tài khoản người dùng."), 404
    try:
        valid = bcrypt.checkpw(current_password.encode("utf-8"), user["passwordHash"].encode("utf-8"))
    except (ValueError, KeyError):
        valid = False
    if not valid:
        return jsonify(message="Mật khẩu hiện tại không chính xác."), 400
    if current_password == new_password:
        return jsonify(message="Mật khẩu mới phải khác mật khẩu hiện tại."), 400

    user["passwordHash"] = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    write_json(USERS_FILE, all_users)
    return jsonify(message="Đổi mật khẩu thành công.")


@app.post("/api/login")
def login():
    data = request_data()
    identifier = str(data.get("username") or data.get("email") or data.get("phone") or "").strip()
    password = str(data.get("password", ""))
    if not identifier or not password:
        return jsonify(message="Vui lòng nhập tên đăng nhập và mật khẩu."), 400
    user = find_user_by_identifier(identifier)
    try:
        valid = user and bcrypt.checkpw(password.encode("utf-8"), user["passwordHash"].encode("utf-8"))
    except (ValueError, KeyError):
        valid = False
    if not valid:
        return jsonify(message="Tên đăng nhập hoặc mật khẩu không chính xác."), 401
    session.clear()
    session["user"] = public_user(user)
    session.permanent = data.get("rememberMe") is True or str(data.get("rememberMe", "")).lower() == "true"
    return jsonify(message="Đăng nhập thành công.", user=session["user"])


@app.post("/api/register")
def register():
    data = request_data()
    full_name = str(data.get("fullName", "")).strip()
    username = normalize_username(data.get("username") or data.get("email") or "")
    phone = normalize_phone(data.get("phone", ""))
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    confirm = str(data.get("confirmPassword", ""))

    if len(full_name) < 2 or len(username) < 3 or len(phone) < 9 or len(password) < 8:
        return jsonify(message="Vui lòng nhập họ tên, tên đăng nhập, số điện thoại hợp lệ và mật khẩu tối thiểu 8 ký tự."), 400
    if password != confirm:
        return jsonify(message="Mật khẩu xác nhận không trùng khớp."), 400
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify(message="Email không hợp lệ."), 400

    all_users = users()
    if any(normalize_username(item.get("username", "")) == username for item in all_users):
        return jsonify(message="Tên đăng nhập này đã được sử dụng."), 409
    if any(normalize_phone(item.get("phone", "")) == phone for item in all_users):
        return jsonify(message="Số điện thoại này đã được sử dụng."), 409
    if email and any(str(item.get("email", "")).strip().lower() == email for item in all_users):
        return jsonify(message="Email này đã được sử dụng."), 409

    user_id = max((item.get("id", 0) for item in all_users), default=0) + 1
    user = {
        "id": user_id,
        "email": email or f"user-{user_id}@hotel.local",
        "username": username,
        "phone": phone,
        "passwordHash": bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8"),
        "fullName": full_name,
    }
    all_users.append(user)
    write_json(USERS_FILE, all_users)
    return jsonify(message="Tạo tài khoản thành công. Bạn có thể đăng nhập ngay.", user=public_user(user)), 201


@app.post("/api/forgot-password/request")
def forgot_password_request():
    data = request_data()
    username = normalize_username(data.get("username", ""))
    phone = normalize_phone(data.get("phone", ""))
    if len(username) < 3 or len(phone) < 9:
        return jsonify(message="Vui lòng nhập tên đăng nhập và số điện thoại hợp lệ."), 400
    user = next((item for item in users() if normalize_username(item.get("username", "")) == username and normalize_phone(item.get("phone", "")) == phone), None)
    if not user:
        return jsonify(message="Tài khoản không tồn tại hoặc số điện thoại không khớp."), 404

    import random
    otp = f"{random.randint(100000, 999999)}"
    PASSWORD_RESET_CODES[username] = {
        "phone": phone,
        "otp": otp,
        "expires_at": time.time() + PASSWORD_RESET_TTL_SECONDS,
    }
    response = {"message": "Mã OTP đã được tạo và gửi qua SMS.", "otp": otp}
    return jsonify(response)


@app.post("/api/forgot-password/verify")
def forgot_password_verify():
    data = request_data()
    username = normalize_username(data.get("username", ""))
    phone = normalize_phone(data.get("phone", ""))
    otp = str(data.get("otp", "")).strip()
    entry = PASSWORD_RESET_CODES.get(username)
    if not entry or entry["phone"] != phone or entry["otp"] != otp:
        return jsonify(message="Mã OTP không hợp lệ hoặc đã hết hạn."), 400
    if time.time() > entry["expires_at"]:
        PASSWORD_RESET_CODES.pop(username, None)
        return jsonify(message="Mã OTP đã hết hạn, vui lòng tạo lại."), 410
    return jsonify(message="OTP hợp lệ. Bạn có thể đặt mật khẩu mới.")


@app.post("/api/forgot-password/reset")
def forgot_password_reset():
    data = request_data()
    username = normalize_username(data.get("username", ""))
    phone = normalize_phone(data.get("phone", ""))
    otp = str(data.get("otp", "")).strip()
    new_password = str(data.get("newPassword", ""))
    if len(new_password) < 8:
        return jsonify(message="Mật khẩu mới phải có ít nhất 8 ký tự."), 400
    entry = PASSWORD_RESET_CODES.get(username)
    if not entry or entry["phone"] != phone or entry["otp"] != otp:
        return jsonify(message="Thông tin xác thực không hợp lệ."), 400
    if time.time() > entry["expires_at"]:
        PASSWORD_RESET_CODES.pop(username, None)
        return jsonify(message="Mã OTP đã hết hạn, vui lòng tạo lại."), 410
    all_users = users()
    user = next((item for item in all_users if normalize_username(item.get("username", "")) == username), None)
    if not user:
        return jsonify(message="Không tìm thấy tài khoản để đổi mật khẩu."), 404
    user["passwordHash"] = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    write_json(USERS_FILE, all_users)
    PASSWORD_RESET_CODES.pop(username, None)
    return jsonify(message="Đổi mật khẩu thành công. Bạn có thể đăng nhập ngay.")


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

    existing_user = next(
        (
            item for item in all_users
            if str(item.get("email", "")).strip().lower() == email
        ),
        None,
    )
    if existing_user:
        if provider not in {"github", "google"}:
            raise OAuthProfileError("email_exists")
        accounts = existing_user.get("oauthAccounts")
        if not isinstance(accounts, dict):
            accounts = {}
            existing_user["oauthAccounts"] = accounts
        linked_subject = accounts.get(provider)
        if linked_subject and linked_subject != subject:
            raise OAuthProfileError("email_exists")
        accounts[provider] = subject
        write_json(USERS_FILE, all_users)
        return existing_user

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
        error_code = "github_not_configured" if provider == "github" else "provider_not_configured"
        return oauth_error_redirect(flow, error_code)

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
        error_code = "github_not_configured" if provider == "github" else "provider_not_configured"
        return oauth_error_redirect(flow, error_code)

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
        rate = float(data.get("hourlyRate", ""))
    except (TypeError, ValueError):
        rate = float("nan")
    return code, description, room_type, rate


@app.post("/api/rooms")
def add_room():
    denied = require_auth()
    if denied:
        return denied
    code, description, room_type, rate = read_room_fields(request.form)
    if not re.fullmatch(r"[A-Za-z0-9-]+", code) or len(description) > 240 or not code or not room_type or not description:
        return jsonify(message="Vui lòng nhập đầy đủ mã phòng, mô tả và thể loại phòng."), 400
    try:
        selected_type = find_room_type(room_type)
        if not selected_type:
            raise ValueError("Loại phòng không hợp lệ.")
        if selected_type["hourlyRate"] is None:
            raise ValueError("Thể loại phòng chưa được thiết lập giá theo giờ. Vui lòng cập nhật giá trong mục Thể loại phòng.")
        rate = selected_type["hourlyRate"]
        image_path = save_upload()
        existing = next((room for room in list_rooms() if room["roomCode"].casefold() == code.casefold()), None)
        if existing:
            raise ValueError("Mã phòng đã tồn tại.")
        if db_available():
            result = query("INSERT INTO rooms (room_code, short_description, image_path, room_type, nightly_rate, hourly_rate, status) VALUES (%s, %s, %s, %s, %s, %s, %s)", (code, description, image_path or None, room_type, rate, rate, "Phòng trống"))
            room = room_by_id(result["lastrowid"])
        else:
            rooms = read_json(ROOMS_FILE, [])
            raw = {"id": max((int(item.get("id", 0)) for item in rooms), default=0) + 1, "roomCode": code, "shortDescription": description, "imagePath": image_path, "roomType": room_type, "hourlyRate": rate, "status": "Phòng trống"}
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
        selected_type = find_room_type(room_type)
        if not selected_type:
            raise ValueError("Loại phòng không hợp lệ.")
        existing_room = room_by_id(room_id)
        if not existing_room:
            return jsonify(message="Không tìm thấy phòng."), 404
        requested_status = normalized_status(data.get("status")) if data.get("status") else None
        if requested_status and requested_status not in {ROOM_AVAILABLE_STATUS, ROOM_MAINTENANCE_STATUS}:
            return jsonify(message="Chỉ có thể chuyển phòng giữa trạng thái trống và bảo trì."), 400
        current_status = normalized_status(existing_room["status"])
        if requested_status and current_status not in {ROOM_AVAILABLE_STATUS, ROOM_MAINTENANCE_STATUS}:
            return jsonify(message="Không thể đổi trạng thái phòng đang được đặt, thuê hoặc dọn phòng."), 409
        image_path = save_upload()
        if db_available():
            rows = query("SELECT id, image_path FROM rooms WHERE id = %s LIMIT 1", (room_id,), fetch=True)["rows"]
            if not rows:
                return jsonify(message="Không tìm thấy phòng."), 404
            duplicates = query("SELECT id FROM rooms WHERE room_code = %s AND id <> %s LIMIT 1", (code, room_id), fetch=True)["rows"]
            if duplicates:
                raise ValueError("Mã phòng đã tồn tại.")
            if requested_status:
                query("UPDATE rooms SET room_code = %s, short_description = %s, image_path = %s, room_type = %s, nightly_rate = %s, hourly_rate = %s, status = %s WHERE id = %s", (code, description, image_path or rows[0]["image_path"], room_type, rate, rate, requested_status, room_id))
            else:
                query("UPDATE rooms SET room_code = %s, short_description = %s, image_path = %s, room_type = %s, nightly_rate = %s, hourly_rate = %s WHERE id = %s", (code, description, image_path or rows[0]["image_path"], room_type, rate, rate, room_id))
            room = room_by_id(room_id)
        else:
            rooms = read_json(ROOMS_FILE, [])
            room = next((item for item in rooms if int(item.get("id", 0)) == room_id), None)
            if not room:
                return jsonify(message="Không tìm thấy phòng."), 404
            if any(int(item.get("id", 0)) != room_id and str(item.get("roomCode", item.get("room_code", item.get("roomNumber", "")))).casefold() == code.casefold() for item in rooms):
                raise ValueError("Mã phòng đã tồn tại.")
            room.update({"roomCode": code, "shortDescription": description, "imagePath": image_path or room.get("imagePath", room.get("image_path", "")), "roomType": room_type, "hourlyRate": rate})
            if requested_status:
                room["status"] = requested_status
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
    if requested not in {"Phòng trống", "Đã thuê", ROOM_CLEANING_STATUS}:
        return jsonify(message="Trạng thái phòng không hợp lệ."), 409
    if requested in {"Đã thuê", ROOM_CLEANING_STATUS}:
        return jsonify(message="Trạng thái phòng phải được cập nhật qua đặt phòng và trả phòng."), 409
    is_check_in = requested == "Đã thuê"
    is_cleaning = requested == ROOM_CLEANING_STATUS
    check_in = None
    check_out = None
    duration_minutes = None
    duration_seconds = None
    if is_check_in:
        try:
            check_in = parse_datetime_value(data.get("checkInAt"))
            check_out = parse_datetime_value(data.get("checkOutAt"))
            if check_in is None or check_out is None:
                raise ValueError
            check_in, check_out = validate_booking_window(check_in, check_out)
        except (TypeError, ValueError):
            return jsonify(message="Vui lòng nhập giờ nhận phòng hiện tại hoặc trong tương lai và thời gian trả phòng hợp lệ."), 400
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
                cursor.execute(
                    "SELECT checked_in_at, checked_out_at FROM rooms WHERE id = %s AND checked_in_at IS NOT NULL AND checked_out_at IS NOT NULL LIMIT 1",
                    (room_id,),
                )
                existing_booking = cursor.fetchone()
                if existing_booking and booking_conflicts([existing_booking], check_in, check_out):
                    connection.rollback()
                    return jsonify(message="Phòng đã được đặt trong khung thời gian này. Vui lòng chọn thời gian nhận phòng hoặc trả phòng khác."), 409
                try:
                    rental_total = calculate_hourly_rental_total(room_hourly_rate(room), duration_minutes)
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
                    rental_total = calculate_hourly_rental_total(room_hourly_rate(room), stored_minutes)
                except (TypeError, ValueError, InvalidOperation):
                    connection.rollback()
                    return jsonify(message="Không thể lưu lịch sử: thông tin lượt thuê hiện tại không hợp lệ."), 409
                cursor.execute(
                    "INSERT INTO rental_history (room_id, checked_in_at, scheduled_check_out_at, returned_at, duration_minutes, rental_total) VALUES (%s, %s, %s, %s, %s, %s)",
                    (room_id, checked_in_at, scheduled_check_out, returned_at, stored_minutes, rental_total),
                )
                cursor.execute(
                    "UPDATE rooms SET status = %s, checked_in_at = NULL, checked_out_at = NULL, rental_duration_seconds = NULL, rental_duration_minutes = NULL, rental_days = NULL, rental_total = NULL, last_cleaning_started_at = NOW(), cleaning_started_at = NOW() WHERE id = %s AND status = %s",
                    (ROOM_CLEANING_STATUS, room_id, "Đã thuê"),
                )
                if not cursor.rowcount:
                    connection.rollback()
                    return jsonify(message="Không thể trả phòng do trạng thái phòng đã thay đổi."), 409
                success_message = "Trả phòng thành công! Đang dọn phòng trong 30 phút."
                room.update({
                    "status": ROOM_CLEANING_STATUS,
                    "checked_in_at": None,
                    "checked_out_at": None,
                    "rental_duration_seconds": None,
                    "rental_duration_minutes": None,
                    "rental_days": None,
                    "rental_total": None,
                    "last_cleaning_started_at": datetime.now().isoformat(timespec="seconds"),
                    "cleaning_started_at": datetime.now().isoformat(timespec="seconds"),
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
            existing_bookings = []
            for item in rooms:
                if int(item.get("id", 0)) != room_id:
                    continue
                for field in ("checkInAt", "check_in_at", "checked_in_at"):
                    check_in_value = item.get(field)
                    check_out_value = item.get("checkOutAt") or item.get("check_out_at") or item.get("checked_out_at")
                    if check_in_value and check_out_value:
                        existing_bookings.append({"check_in": check_in_value, "check_out": check_out_value})
            if booking_conflicts(existing_bookings, check_in, check_out):
                return jsonify(message="Phòng đã được đặt trong khung thời gian này. Vui lòng chọn thời gian nhận phòng hoặc trả phòng khác."), 409
            try:
                rental_total = calculate_hourly_rental_total(room_hourly_rate(room), duration_minutes)
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
                rental_total = calculate_hourly_rental_total(room_hourly_rate(room), stored_minutes)
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
            room["last_cleaning_started_at"] = datetime.now().isoformat(timespec="seconds")
            room["cleaning_started_at"] = room["last_cleaning_started_at"]
            success_message = "Trả phòng thành công! Đang dọn phòng trong 30 phút."
        room["status"] = ROOM_CLEANING_STATUS if not is_check_in else requested
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
    try:
        hourly_rate = parse_room_type_rate(request_data().get("hourlyRate"))
    except ValueError as error:
        return jsonify(message=str(error)), 400
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
            query("INSERT INTO room_types (code, name, description, hourly_rate) VALUES (%s, %s, %s, %s)", (code, name, description, hourly_rate))
        else:
            types.append({"code": code, "name": name, "description": description, "hourlyRate": float(hourly_rate)})
            write_json(ROOM_TYPES_FILE, types)
        return jsonify(message="Thêm thể loại phòng thành công.", roomType={"code": code, "name": name, "description": description, "hourlyRate": float(hourly_rate)}), 201
    except ValueError as error:
        return jsonify(message=str(error)), 400
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
        hourly_rate = parse_room_type_rate(payload.get("hourlyRate", current.get("hourlyRate")))
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
                cursor.execute("UPDATE room_types SET name = %s, description = %s, hourly_rate = %s WHERE code = %s", (name, description, hourly_rate, code))
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
                    item["hourlyRate"] = float(hourly_rate)
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
        return jsonify(message="Cập nhật thể loại phòng thành công.", roomType={"code": code, "name": name, "description": description, "hourlyRate": float(hourly_rate)})
    except ValueError as error:
        return jsonify(message=str(error)), 400
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


@app.errorhandler(404)
def not_found(_error):
    return jsonify(message="Không tìm thấy endpoint."), 404


@app.errorhandler(405)
def method_not_allowed(_error):
    return jsonify(message="Phương thức HTTP không được phép cho endpoint này."), 405


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    initialize_database()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "3001")), debug=False)
