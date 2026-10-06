from datetime import datetime

import pytest

from app import apply_booking_lifecycle, booking_conflicts, derived_room_status, validate_booking_window


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
