from datetime import datetime, timedelta

import app as hotel_app


def authenticated_client(monkeypatch, tmp_path):
    monkeypatch.setattr(hotel_app, "db_available", lambda: False)
    monkeypatch.setattr(hotel_app, "DATA_DIR", tmp_path)
    monkeypatch.setattr(hotel_app, "CUSTOMERS_FILE", tmp_path / "customers.json")
    monkeypatch.setattr(hotel_app, "BOOKINGS_FILE", tmp_path / "bookings.json")
    monkeypatch.setattr(hotel_app, "ROOMS_FILE", tmp_path / "rooms.json")
    hotel_app.app.config.update(TESTING=True)
    client = hotel_app.app.test_client()
    with client.session_transaction() as session:
        session["user"] = {"id": 1}
    return client


def test_create_and_list_customer_with_json_storage(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)

    response = client.post("/api/customers", json={
        "fullName": "Nguyễn Văn An",
        "phone": "0987 654 321",
        "identityNumber": "001234567890",
        "email": "an@example.com",
        "address": "Hà Nội",
        "dateOfBirth": "1995-05-20",
        "gender": "female",
        "notes": "Ưu tiên phòng yên tĩnh",
    })

    assert response.status_code == 201
    customer = response.get_json()["customer"]
    assert customer["fullName"] == "Nguyễn Văn An"
    assert customer["phone"] == "0987654321"
    assert customer["bookingCount"] == 0
    assert customer["dateOfBirth"] == "1995-05-20"
    assert customer["gender"] == "female"
    assert customer["notes"] == "Ưu tiên phòng yên tĩnh"

    listed = client.get("/api/customers")
    assert listed.status_code == 200
    assert listed.get_json()["customers"] == [customer]


def test_create_customer_rejects_future_birth_date_and_invalid_gender(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    customer_data = {
        "fullName": "Nguyễn Văn An",
        "phone": "0987654321",
        "dateOfBirth": "2999-01-01",
        "gender": "invalid",
    }

    future_date = client.post("/api/customers", json=customer_data)
    invalid_gender = client.post("/api/customers", json={
        **customer_data,
        "dateOfBirth": "1995-05-20",
    })

    assert future_date.status_code == 400
    assert "ngày sinh" in future_date.get_json()["message"]
    assert invalid_gender.status_code == 400
    assert "giới tính" in invalid_gender.get_json()["message"]


def test_customer_phone_must_be_unique(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    customer_data = {"fullName": "Nguyễn Văn An", "phone": "0987654321"}

    assert client.post("/api/customers", json=customer_data).status_code == 201
    duplicate = client.post("/api/customers", json={**customer_data, "fullName": "Trần Thị Mai"})

    assert duplicate.status_code == 409
    assert "đã được sử dụng" in duplicate.get_json()["message"]


def test_update_customer_persists_changes_and_preserves_booking_count(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    customer = client.post("/api/customers", json={
        "fullName": "Nguyễn Văn An",
        "phone": "0987654321",
        "identityNumber": "001234567890",
        "email": "an@example.com",
    }).get_json()["customer"]
    hotel_app.write_json(hotel_app.BOOKINGS_FILE, [{
        "id": 10,
        "customerId": customer["id"],
    }])

    response = client.put(f"/api/customers/{customer['id']}", json={
        "fullName": "Nguyễn Văn An Updated",
        "phone": "0901234567",
        "identityNumber": "009876543210",
        "email": "updated@example.com",
        "address": "Hà Nội",
        "dateOfBirth": "1995-05-20",
        "gender": "female",
        "notes": "Đã cập nhật",
    })

    assert response.status_code == 200
    updated_customer = response.get_json()["customer"]
    assert updated_customer["fullName"] == "Nguyễn Văn An Updated"
    assert updated_customer["phone"] == "0901234567"
    assert updated_customer["bookingCount"] == 1
    assert updated_customer["notes"] == "Đã cập nhật"
    assert client.get("/api/customers").get_json()["customers"][0] == updated_customer


def test_update_customer_rejects_duplicate_phone_and_unknown_customer(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    first = client.post("/api/customers", json={
        "fullName": "Nguyễn Văn An",
        "phone": "0987654321",
    }).get_json()["customer"]
    second = client.post("/api/customers", json={
        "fullName": "Trần Thị Mai",
        "phone": "0901234567",
    }).get_json()["customer"]

    duplicate = client.put(f"/api/customers/{second['id']}", json={
        "fullName": "Trần Thị Mai",
        "phone": first["phone"],
    })
    unknown = client.put("/api/customers/999", json={
        "fullName": "Không tồn tại",
        "phone": "0912345678",
    })

    assert duplicate.status_code == 409
    assert unknown.status_code == 404


def test_normalize_booking_includes_customer_and_guest_details():
    booking = hotel_app.normalize_booking({
        "id": 12,
        "room_id": 101,
        "customer_id": 4,
        "customer_name": "Nguyễn Văn An",
        "customer_phone": "0987654321",
        "guest_count": 2,
        "notes": "Phòng yên tĩnh",
    })

    assert booking["customerId"] == 4
    assert booking["customerName"] == "Nguyễn Văn An"
    assert booking["customerPhone"] == "0987654321"
    assert booking["guestCount"] == 2
    assert booking["notes"] == "Phòng yên tĩnh"


def test_create_booking_saves_customer_guest_count_and_notes(monkeypatch, tmp_path):
    client = authenticated_client(monkeypatch, tmp_path)
    hotel_app.write_json(hotel_app.ROOMS_FILE, [{
        "id": 1,
        "room_code": "101",
        "room_type": "Đơn",
        "hourly_rate": 500000,
        "status": "Phòng trống",
    }])
    customer = client.post("/api/customers", json={
        "fullName": "Nguyễn Văn An",
        "phone": "0987654321",
    }).get_json()["customer"]
    check_in = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=2)
    check_out = check_in + timedelta(days=1)

    response = client.post("/api/bookings", json={
        "roomId": 1,
        "customerId": customer["id"],
        "checkInAt": check_in.isoformat(timespec="minutes"),
        "checkOutAt": check_out.isoformat(timespec="minutes"),
        "guestCount": 2,
        "notes": "Phòng yên tĩnh",
    })

    assert response.status_code == 201
    booking = response.get_json()["booking"]
    assert booking["customerId"] == customer["id"]
    assert booking["customerName"] == "Nguyễn Văn An"
    assert booking["guestCount"] == 2
    assert booking["notes"] == "Phòng yên tĩnh"

    listed_booking = client.get("/api/bookings").get_json()["bookings"][0]
    listed_customer = client.get("/api/customers").get_json()["customers"][0]
    assert listed_booking["roomCode"] == "101"
    assert listed_booking["customerName"] == "Nguyễn Văn An"
    assert listed_customer["bookingCount"] == 1
