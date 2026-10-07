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


def test_room_type_fixed_rate_is_used_for_new_room_and_can_be_updated(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)

    created_type = client.post("/api/room-types", json={
        "name": "Phòng tiêu chuẩn",
        "description": "Tầng thấp",
        "nightlyRate": 500000,
    })

    assert created_type.status_code == 201
    room_type = created_type.get_json()["roomType"]
    assert room_type["nightlyRate"] == 500000

    updated_type = client.put(f"/api/room-types/{room_type['code']}", json={
        "name": room_type["name"],
        "description": room_type["description"],
        "nightlyRate": 750000,
    })

    assert updated_type.status_code == 200
    assert updated_type.get_json()["roomType"]["nightlyRate"] == 750000

    created_room = client.post("/api/rooms", data={
        "roomCode": "P101",
        "shortDescription": "Phòng nhìn ra vườn",
        "roomType": room_type["name"],
        "nightlyRate": "1",
    })

    assert created_room.status_code == 201
    assert created_room.get_json()["room"]["nightlyRate"] == 750000


def test_room_type_requires_a_positive_fixed_rate(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)

    missing_rate = client.post("/api/room-types", json={"name": "Phòng tiêu chuẩn"})
    invalid_rate = client.post("/api/room-types", json={
        "name": "Phòng cao cấp",
        "nightlyRate": 0,
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
        "nightlyRate": "500000",
    })

    assert response.status_code == 400
    assert "chưa được thiết lập giá cố định" in response.get_json()["message"]
