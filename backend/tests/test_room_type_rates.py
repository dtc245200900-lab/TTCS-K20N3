from datetime import datetime, timedelta

import app as hotel_app


def authenticated_client(monkeypatch, tmp_path):
    monkeypatch.setattr(hotel_app, "db_available", lambda: False)
    monkeypatch.setattr(hotel_app, "DATA_DIR", tmp_path)
    monkeypatch.setattr(hotel_app, "ROOMS_FILE", tmp_path / "rooms.json")
    monkeypatch.setattr(hotel_app, "BOOKINGS_FILE", tmp_path / "bookings.json")
    monkeypatch.setattr(hotel_app, "ROOM_TYPES_FILE", tmp_path / "room-types.json")
    hotel_app.app.config.update(TESTING=True)
    client = hotel_app.app.test_client()
    with client.session_transaction() as session:
        session["user"] = {"id": 1}
    return client


def test_room_type_hourly_rate_is_used_for_new_room_and_can_be_updated(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)

    created_type = client.post("/api/room-types", json={
        "name": "Phòng tiêu chuẩn",
        "description": "Tầng thấp",
        "hourlyRate": 500000,
    })

    assert created_type.status_code == 201
    room_type = created_type.get_json()["roomType"]
    assert room_type["hourlyRate"] == 500000

    updated_type = client.put(f"/api/room-types/{room_type['code']}", json={
        "name": room_type["name"],
        "description": room_type["description"],
        "hourlyRate": 750000,
    })

    assert updated_type.status_code == 200
    assert updated_type.get_json()["roomType"]["hourlyRate"] == 750000

    created_room = client.post("/api/rooms", data={
        "roomCode": "P101",
        "shortDescription": "Phòng nhìn ra vườn",
        "roomType": room_type["name"],
        "hourlyRate": "1",
    })

    assert created_room.status_code == 201
    assert created_room.get_json()["room"]["hourlyRate"] == 750000


def test_new_room_starts_available_and_existing_room_can_be_set_to_maintenance(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    created_type = client.post("/api/room-types", json={
        "name": "Phòng tiêu chuẩn",
        "hourlyRate": 150000,
    })
    room_type = created_type.get_json()["roomType"]
    created_room = client.post("/api/rooms", data={
        "roomCode": "P102",
        "shortDescription": "Phòng gần sảnh",
        "roomType": room_type["name"],
        "hourlyRate": "150000",
        "status": "Bảo trì",
    })

    assert created_room.status_code == 201
    room = created_room.get_json()["room"]
    assert room["status"] == hotel_app.ROOM_AVAILABLE_STATUS

    updated_room = client.put(f"/api/rooms/{room['id']}", data={
        "roomCode": room["roomCode"],
        "shortDescription": room["shortDescription"],
        "roomType": room["roomType"],
        "hourlyRate": str(room["hourlyRate"]),
        "status": hotel_app.ROOM_MAINTENANCE_STATUS,
    })

    assert updated_room.status_code == 200
    assert updated_room.get_json()["room"]["status"] == hotel_app.ROOM_MAINTENANCE_STATUS


def test_room_type_requires_a_positive_hourly_rate(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)

    missing_rate = client.post("/api/room-types", json={"name": "Phòng tiêu chuẩn"})
    invalid_rate = client.post("/api/room-types", json={
        "name": "Phòng cao cấp",
        "hourlyRate": 0,
    })

    assert missing_rate.status_code == 400
    assert invalid_rate.status_code == 400


def test_room_cannot_be_created_with_unconfigured_legacy_type(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    hotel_app.write_json(hotel_app.ROOM_TYPES_FILE, [{
        "code": "LP001",
        "name": "Phòng cũ",
        "description": "",
    }])

    response = client.post("/api/rooms", data={
        "roomCode": "P101",
        "shortDescription": "Phòng nhìn ra vườn",
        "roomType": "Phòng cũ",
        "hourlyRate": "500000",
    })

    assert response.status_code == 400
    assert "chưa được thiết lập giá theo giờ" in response.get_json()["message"]


def test_legacy_daily_rate_is_not_used_as_an_hourly_rate(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    hotel_app.write_json(hotel_app.ROOM_TYPES_FILE, [{
        "code": "LP001",
        "name": "Loại phòng cũ",
        "description": "",
        "nightlyRate": 900000,
    }])

    result = client.get("/api/room-types")
    legacy_type = result.get_json()["roomTypes"][0]

    assert legacy_type["hourlyRate"] is None


def test_hourly_rental_rounds_up_partial_hours():
    assert hotel_app.calculate_hourly_rental_total(100000, 1) == 100000
    assert hotel_app.calculate_hourly_rental_total(100000, 60) == 100000
    assert hotel_app.calculate_hourly_rental_total(100000, 61) == 200000
    assert hotel_app.calculate_hourly_rental_total(100000, 121) == 300000


def test_booking_keeps_hourly_rate_snapshot(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    created_type = client.post("/api/room-types", json={
        "name": "Phòng theo giờ",
        "hourlyRate": 125000,
    })
    room_type = created_type.get_json()["roomType"]
    created_room = client.post("/api/rooms", data={
        "roomCode": "H101",
        "shortDescription": "Phòng lưu trú theo giờ",
        "roomType": room_type["name"],
        "hourlyRate": "1",
    })
    room = created_room.get_json()["room"]
    check_in = datetime.now() + timedelta(days=1)
    check_out = check_in + timedelta(minutes=61)

    booking_response = client.post("/api/bookings", json={
        "roomId": room["id"],
        "checkInAt": check_in.isoformat(timespec="minutes"),
        "checkOutAt": check_out.isoformat(timespec="minutes"),
    })

    assert booking_response.status_code == 201
    booking = booking_response.get_json()["booking"]
    assert booking["hourlyRate"] == 125000


def test_checkout_charges_started_hours_using_booking_rate_snapshot(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    checked_in = datetime.now() - timedelta(minutes=60)
    hotel_app.write_json(hotel_app.ROOMS_FILE, [{
        "id": 7,
        "roomCode": "H101",
        "roomType": "Phòng theo giờ",
        "hourlyRate": 120000,
        "status": "Đã thuê",
    }])
    hotel_app.write_json(hotel_app.BOOKINGS_FILE, [{
        "id": 9,
        "room_id": 7,
        "status": hotel_app.BOOKING_CHECKED_IN_STATUS,
        "actual_check_in_at": checked_in.isoformat(timespec="seconds"),
        "hourly_rate": 80000,
    }])

    response = client.patch("/api/bookings/9/check-out")

    assert response.status_code == 200
    assert response.get_json()["booking"]["rentalTotal"] == 160000
    assert response.get_json()["booking"]["durationMinutes"] >= 61
