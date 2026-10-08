from datetime import datetime, timedelta

import pytest

import app as hotel_app
from app import (
    apply_booking_lifecycle,
    booking_conflicts,
    calculate_rental_total,
    derived_room_status,
    process_expired_rentals,
    validate_booking_window,
)


def test_validate_booking_window_allows_present_and_future_checkin():
    now = datetime(2026, 10, 6, 22, 27, 10)

    assert validate_booking_window(now, now.replace(hour=23), now) == (
        datetime(2026, 10, 6, 22, 27),
        datetime(2026, 10, 6, 23, 27),
    )
    assert validate_booking_window(now.replace(minute=28), now.replace(hour=23, minute=28), now) == (
        datetime(2026, 10, 6, 22, 28),
        datetime(2026, 10, 6, 23, 28),
    )
    assert validate_booking_window(now, now.replace(hour=23), now) == (
        datetime(2026, 10, 6, 22, 27),
        datetime(2026, 10, 6, 23, 27),
    )


def test_validate_booking_window_rejects_past_checkin_and_invalid_checkout():
    now = datetime(2026, 10, 6, 22, 27, 10)

    with pytest.raises(ValueError, match="không được ở quá khứ"):
        validate_booking_window(now.replace(minute=26), now.replace(hour=23, minute=26), now)

    with pytest.raises(ValueError, match="phải sau"):
        validate_booking_window(now, now, now)


def test_booking_conflicts_detects_overlapping_ranges():
    existing = [
        (datetime(2026, 10, 6, 12, 0), datetime(2026, 10, 6, 14, 0)),
        (datetime(2026, 10, 6, 16, 0), datetime(2026, 10, 6, 18, 0)),
    ]
    now = datetime(2026, 10, 6, 12, 0)

    assert booking_conflicts(existing, datetime(2026, 10, 6, 13, 0), datetime(2026, 10, 6, 15, 0), now=now)
    assert not booking_conflicts(existing, datetime(2026, 10, 6, 15, 0), datetime(2026, 10, 6, 16, 0), now=now)


def test_apply_booking_lifecycle_transitions_pending_to_checked_in():
    now = datetime(2026, 10, 6, 22, 30)
    booking = {
        "status": "pending",
        "scheduledCheckInAt": "2026-10-06T22:30:00",
        "actualCheckInAt": None,
    }

    updated = apply_booking_lifecycle(booking, now)

    assert updated["status"] == "checked_in"
    assert updated["actualCheckInAt"] == now.isoformat()


def test_apply_booking_lifecycle_keeps_future_pending_booking():
    now = datetime(2026, 10, 6, 22, 30)
    booking = {
        "status": "pending",
        "scheduledCheckInAt": "2026-10-06T22:31:00",
        "actualCheckInAt": None,
    }

    updated = apply_booking_lifecycle(booking, now)

    assert updated["status"] == "pending"
    assert updated["actualCheckInAt"] is None


def test_apply_booking_lifecycle_preserves_checked_out_cleaning_state():
    now = datetime(2026, 10, 6, 23, 30)
    booking = {
        "status": "checked_out",
        "cleaningUntil": "2026-10-06T23:30:00",
    }

    updated = apply_booking_lifecycle(booking, now)

    assert updated["status"] == "checked_out"
    assert updated["cleaningUntil"] == "2026-10-06T23:30:00"


def test_derived_room_status_becomes_available_after_cleaning_timeout():
    now = datetime(2026, 10, 6, 23, 31)
    room = {"status": "Đã thuê"}
    booking = {
        "status": "checked_out",
        "cleaningUntil": "2026-10-06T23:30:00",
    }

    assert derived_room_status(room, booking, now) == "Phòng trống"


def test_expired_booking_is_checked_out_and_kept_in_history_files(monkeypatch, tmp_path):
    now = datetime(2026, 10, 8, 18, 0)
    rooms_file = tmp_path / "rooms.json"
    bookings_file = tmp_path / "bookings.json"
    monkeypatch.setattr(hotel_app, "db_available", lambda: False)
    monkeypatch.setattr(hotel_app, "ROOMS_FILE", rooms_file)
    monkeypatch.setattr(hotel_app, "BOOKINGS_FILE", bookings_file)
    hotel_app.write_json(rooms_file, [
        {"id": 1, "roomCode": "P101", "roomType": "Đôi", "status": "Phòng trống", "hourlyRate": 10000}
    ])
    hotel_app.write_json(bookings_file, [
        {
            "id": 1,
            "room_id": 1,
            "status": "checked_in",
            "actual_check_in_at": "2026-10-08T16:30:00",
            "scheduled_check_out_at": "2026-10-08T17:30:00",
            "hourly_rate": 10000,
        }
    ])

    checked_out = process_expired_rentals(now, database_available=False)

    booking = hotel_app.read_json(bookings_file, [])[0]
    assert checked_out == ["P101"]
    assert booking["status"] == "checked_out"
    assert booking["actual_check_out_at"] == "2026-10-08T17:30:00"
    assert booking["cleaning_until"] == "2026-10-08T18:00:00"
    assert booking["duration_minutes"] == 60
    assert booking["rental_total"] == 10000


def test_expired_direct_rental_is_checked_out_once_and_room_enters_cleaning(monkeypatch, tmp_path):
    now = datetime.now()
    scheduled_check_out = now.replace(second=0, microsecond=0) - timedelta(minutes=1)
    scheduled_check_in = scheduled_check_out - timedelta(hours=1)
    rooms_file = tmp_path / "rooms.json"
    bookings_file = tmp_path / "bookings.json"
    monkeypatch.setattr(hotel_app, "db_available", lambda: False)
    monkeypatch.setattr(hotel_app, "ROOMS_FILE", rooms_file)
    monkeypatch.setattr(hotel_app, "BOOKINGS_FILE", bookings_file)
    hotel_app.write_json(rooms_file, [
        {
            "id": 1,
            "roomCode": "P102",
            "status": "Đã thuê",
            "checkInAt": scheduled_check_in.isoformat(timespec="seconds"),
            "checkOutAt": scheduled_check_out.isoformat(timespec="seconds"),
            "hourlyRate": 10000,
        }
    ])
    hotel_app.write_json(bookings_file, [])

    checked_out = process_expired_rentals(now, database_available=False)
    room = hotel_app.read_json(rooms_file, [])[0]
    second_run = process_expired_rentals(now, database_available=False)

    assert checked_out == ["P102"]
    assert second_run == []
    assert room["status"] == "Đang dọn phòng"
    assert room["checkOutAt"] is None
    assert room["rentalHistory"][0]["returnedAt"] == scheduled_check_out.isoformat(timespec="minutes")
    assert room["rentalHistory"][0]["durationMinutes"] == 60
    assert room["rentalHistory"][0]["rentalTotal"] == 10000
    normalized_room = hotel_app.normalize_room(room)
    assert normalized_room["cleaningStartedAt"] == scheduled_check_out.isoformat(timespec="seconds")
    assert normalized_room["cleaningUntil"] == (scheduled_check_out + timedelta(minutes=30)).isoformat(timespec="seconds")


def test_rental_total_uses_fixed_daily_rate():
    assert calculate_rental_total(500000, 1440) == 500000
    assert calculate_rental_total(500000, 720) == 250000


def test_list_rooms_uses_latest_bookings_without_per_room_lookups(monkeypatch, tmp_path):
    monkeypatch.setattr(hotel_app, "db_available", lambda: False)
    monkeypatch.setattr(hotel_app, "ROOMS_FILE", tmp_path / "rooms.json")
    monkeypatch.setattr(hotel_app, "BOOKINGS_FILE", tmp_path / "bookings.json")
    hotel_app.app.config.update(TESTING=True)

    hotel_app.write_json(hotel_app.ROOMS_FILE, [
        {"id": room_id, "room_code": str(room_id), "status": "Phòng trống"}
        for room_id in range(1, 11)
    ])
    hotel_app.write_json(hotel_app.BOOKINGS_FILE, [
        {"id": 1, "room_id": 1, "status": "checked_in"},
        {"id": 2, "room_id": 1, "status": "cancelled"},
    ])

    def unexpected_lookup(*args, **kwargs):
        raise AssertionError("Room-list loading must not query bookings once per room.")

    monkeypatch.setattr(hotel_app, "latest_booking_for_room", unexpected_lookup)
    client = hotel_app.app.test_client()
    with client.session_transaction() as session:
        session["user"] = {"id": 1}

    response = client.get("/api/rooms")

    assert response.status_code == 200
    room = next(item for item in response.get_json()["rooms"] if item["id"] == 1)
    assert room["status"] == hotel_app.ROOM_OCCUPIED_STATUS
    assert room["bookingId"] == 1
    assert all(item["status"] == "Phòng trống" for item in response.get_json()["rooms"][1:])
