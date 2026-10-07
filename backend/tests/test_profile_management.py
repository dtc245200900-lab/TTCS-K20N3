from io import BytesIO

import app as hotel_app


def authenticated_client(monkeypatch, tmp_path):
    monkeypatch.setattr(hotel_app, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setattr(hotel_app, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(hotel_app, "DATA_DIR", tmp_path)
    hotel_app.app.config.update(TESTING=True)
    user = {
        "id": 1,
        "email": "member@example.com",
        "username": "member",
        "passwordHash": "not-used-by-this-test",
        "fullName": "Tên cũ",
        "dateOfBirth": "1990-01-01",
        "phone": "0912345678",
    }
    hotel_app.write_json(hotel_app.USERS_FILE, [user])
    client = hotel_app.app.test_client()
    with client.session_transaction() as session:
        session["user"] = hotel_app.public_user(user)
    return client, user


def profile_form(**overrides):
    return {
        "fullName": "Nguyễn Thị An",
        "username": "member",
        "email": "member@example.com",
        "dateOfBirth": "1995-05-20",
        "phone": "0912345678",
        "gender": "female",
        "address": "Hà Nội",
        **overrides,
    }


def test_profile_update_saves_email_and_username_and_updates_session(monkeypatch, tmp_path):
    client, _ = authenticated_client(monkeypatch, tmp_path)

    response = client.put("/api/profile", data=profile_form(
        email="changed@example.com",
        username="new-member",
    ))

    assert response.status_code == 200
    user = response.get_json()["user"]
    assert user["fullName"] == "Nguyễn Thị An"
    assert user["dateOfBirth"] == "1995-05-20"
    assert user["phone"] == "0912345678"
    assert user["email"] == "changed@example.com"
    assert user["username"] == "new-member"
    assert client.get("/api/session").get_json()["user"] == user


def test_profile_update_rejects_duplicate_email_and_username(monkeypatch, tmp_path):
    client, _ = authenticated_client(monkeypatch, tmp_path)
    users = hotel_app.read_json(hotel_app.USERS_FILE, [])
    users.append({
        "id": 2,
        "email": "other@example.com",
        "username": "other-member",
        "fullName": "Người khác",
        "phone": "0987654321",
    })
    hotel_app.write_json(hotel_app.USERS_FILE, users)

    duplicate_email = client.put("/api/profile", data=profile_form(email="OTHER@example.com"))
    duplicate_username = client.put("/api/profile", data=profile_form(username="OTHER-MEMBER"))

    assert duplicate_email.status_code == 409
    assert "Email này" in duplicate_email.get_json()["message"]
    assert duplicate_username.status_code == 409
    assert "Tên đăng nhập" in duplicate_username.get_json()["message"]


def test_profile_update_rejects_future_birth_date_and_invalid_phone(monkeypatch, tmp_path):
    client, _ = authenticated_client(monkeypatch, tmp_path)

    future_date = client.put("/api/profile", data=profile_form(dateOfBirth="2999-01-01"))
    invalid_phone = client.put("/api/profile", data=profile_form(phone="12"))

    assert future_date.status_code == 400
    assert "ngày sinh" in future_date.get_json()["message"]
    assert invalid_phone.status_code == 400
    assert "số điện thoại" in invalid_phone.get_json()["message"]
    invalid_username = client.put("/api/profile", data=profile_form(username="ab"))
    assert invalid_username.status_code == 400
    assert "Tên đăng nhập" in invalid_username.get_json()["message"]


def test_profile_phone_must_be_unique_across_accounts(monkeypatch, tmp_path):
    client, _ = authenticated_client(monkeypatch, tmp_path)
    users = hotel_app.read_json(hotel_app.USERS_FILE, [])
    users.append({
        "id": 2,
        "email": "other@example.com",
        "phone": "0987654321",
        "fullName": "Người khác",
    })
    hotel_app.write_json(hotel_app.USERS_FILE, users)

    response = client.put("/api/profile", data=profile_form(phone="+84 987 654 321"))

    assert response.status_code == 409
    assert "đã được sử dụng" in response.get_json()["message"]


def test_profile_update_saves_avatar_upload(monkeypatch, tmp_path):
    client, _ = authenticated_client(monkeypatch, tmp_path)

    response = client.put("/api/profile", data={
        **profile_form(),
        "avatar": (BytesIO(b"test-image"), "avatar.png", "image/png"),
    })

    assert response.status_code == 200
    avatar_path = response.get_json()["user"]["avatar"]
    assert avatar_path.startswith("/uploads/")
    assert (tmp_path / "uploads" / avatar_path.rsplit("/", 1)[-1]).read_bytes() == b"test-image"
