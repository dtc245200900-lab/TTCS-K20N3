import app as hotel_app


def setup_users(monkeypatch, tmp_path, user):
    monkeypatch.setattr(hotel_app, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setattr(hotel_app, "DATA_DIR", tmp_path)
    hotel_app.write_json(hotel_app.USERS_FILE, [user])
    hotel_app.PASSWORD_RESET_CODES.pop(user["username"], None)
    return hotel_app.app.test_client()


def test_password_reset_sends_otp_to_registered_email(monkeypatch, tmp_path):
    user = {
        "id": 1,
        "email": "member@gmail.com",
        "username": "member",
        "phone": "0912345678",
        "passwordHash": "old-hash",
    }
    client = setup_users(monkeypatch, tmp_path, user)
    sent_messages = []
    monkeypatch.setenv("GMAIL_USERNAME", "sender@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "test-app-password")
    monkeypatch.setattr(hotel_app, "send_password_reset_email", lambda email, otp: sent_messages.append((email, otp)))

    response = client.post("/api/forgot-password/request", json={"username": "member"})

    assert response.status_code == 200
    assert response.get_json() == {
        "message": "Mã OTP đã được gửi đến email đăng ký của bạn.",
        "destination": "me***@gmail.com",
    }
    assert len(sent_messages) == 1
    assert sent_messages[0][0] == "member@gmail.com"
    assert sent_messages[0][1].isdigit() and len(sent_messages[0][1]) == 6


def test_password_reset_email_supports_smtp_env_aliases(monkeypatch):
    for name in ("GMAIL_USERNAME", "GMAIL_APP_PASSWORD", "GMAIL_SENDER", "GMAIL_SMTP_HOST", "GMAIL_SMTP_PORT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SMTP_EMAIL", "sender@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "test-app-password")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    smtp_calls = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            smtp_calls["connection"] = (host, port, timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def starttls(self):
            smtp_calls["starttls"] = True

        def login(self, username, password):
            smtp_calls["login"] = (username, password)

        def send_message(self, message):
            smtp_calls["message"] = message

    monkeypatch.setattr(hotel_app.smtplib, "SMTP", FakeSMTP)

    hotel_app.send_password_reset_email("member@gmail.com", "123456")

    assert smtp_calls["connection"] == ("smtp.example.com", 587, 10)
    assert smtp_calls["starttls"]
    assert smtp_calls["login"] == ("sender@gmail.com", "test-app-password")
    assert smtp_calls["message"]["From"] == "sender@gmail.com"
    assert smtp_calls["message"]["To"] == "member@gmail.com"


def test_password_reset_rejects_account_without_email(monkeypatch, tmp_path):
    user = {"id": 1, "email": "", "username": "member", "phone": "0912345678"}
    client = setup_users(monkeypatch, tmp_path, user)
    send_email = []
    monkeypatch.setenv("GMAIL_USERNAME", "sender@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "test-app-password")
    monkeypatch.setattr(hotel_app, "send_password_reset_email", lambda *args: send_email.append(args))

    response = client.post("/api/forgot-password/request", json={"username": "member"})

    assert response.status_code == 400
    assert send_email == []


def test_password_reset_does_not_return_demo_otp_without_gmail(monkeypatch, tmp_path):
    user = {
        "id": 1,
        "email": "member@gmail.com",
        "username": "member",
        "phone": "0912345678",
    }
    client = setup_users(monkeypatch, tmp_path, user)
    monkeypatch.delenv("GMAIL_USERNAME", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    monkeypatch.setenv("NODE_ENV", "development")

    response = client.post("/api/forgot-password/request", json={
        "username": "member",
        "channel": "email",
    })

    assert response.status_code == 503
    assert "otp" not in response.get_json()
    assert "member" not in hotel_app.PASSWORD_RESET_CODES


def test_password_reset_sends_otp_to_registered_phone(monkeypatch, tmp_path):
    user = {
        "id": 1,
        "email": "member@gmail.com",
        "username": "member",
        "phone": "0912345678",
        "passwordHash": "old-hash",
    }
    client = setup_users(monkeypatch, tmp_path, user)
    sent_messages = []
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "test-account-sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-auth-token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15005550006")
    monkeypatch.setattr(hotel_app, "send_password_reset_sms", lambda phone, otp: sent_messages.append((phone, otp)))

    response = client.post("/api/forgot-password/request", json={
        "username": "member",
        "channel": "sms",
    })

    assert response.status_code == 200
    assert response.get_json() == {
        "message": "Mã OTP đã được gửi qua SMS đến số điện thoại đăng ký.",
        "destination": "*** *** 678",
    }
    assert len(sent_messages) == 1
    assert sent_messages[0][0] == "+84912345678"
    assert sent_messages[0][1].isdigit() and len(sent_messages[0][1]) == 6


def test_password_reset_sms_requires_twilio_configuration(monkeypatch, tmp_path):
    user = {
        "id": 1,
        "email": "member@gmail.com",
        "username": "member",
        "phone": "0912345678",
    }
    client = setup_users(monkeypatch, tmp_path, user)
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_FROM_NUMBER", raising=False)
    monkeypatch.delenv("TWILIO_MESSAGING_SERVICE_SID", raising=False)

    response = client.post("/api/forgot-password/request", json={
        "username": "member",
        "channel": "sms",
    })

    assert response.status_code == 503
    assert "Twilio" in response.get_json()["message"]


def test_wrong_otp_is_rejected_and_correct_otp_allows_password_reset(monkeypatch, tmp_path):
    user = {
        "id": 1,
        "email": "member@gmail.com",
        "username": "member",
        "phone": "0912345678",
        "passwordHash": "old-hash",
    }
    client = setup_users(monkeypatch, tmp_path, user)
    hotel_app.PASSWORD_RESET_CODES["member"] = {
        "phone": "0912345678",
        "otp": "123456",
        "expires_at": hotel_app.time.time() + 300,
    }

    wrong_code = client.post("/api/forgot-password/verify", json={
        "username": "member",
        "otp": "000000",
    })
    correct_code = client.post("/api/forgot-password/verify", json={
        "username": "member",
        "otp": "123456",
    })
    reset = client.post("/api/forgot-password/reset", json={
        "username": "member",
        "otp": "123456",
        "newPassword": "NewSecurePass123",
    })

    assert wrong_code.status_code == 400
    assert "không hợp lệ" in wrong_code.get_json()["message"]
    assert correct_code.status_code == 200
    assert reset.status_code == 200
    saved_user = hotel_app.read_json(hotel_app.USERS_FILE, [])[0]
    assert hotel_app.bcrypt.checkpw(b"NewSecurePass123", saved_user["passwordHash"].encode())