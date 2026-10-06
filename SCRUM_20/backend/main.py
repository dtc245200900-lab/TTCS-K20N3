from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import uuid

app = Flask(__name__)
CORS(app)

# ==============================================================================
# SCRUM-20: QUẢN LÝ PHIÊN LÀM VIỆC (SLIDING SESSION 30 PHÚT) & TOKEN SERVER
# ==============================================================================
SESSION_TIMEOUT_SECONDS = 1800  # 30 phút
sessions = {}            # { token: { "username": str, "last_active": timestamp } }
token_blacklist = set()  # Lưu các token đã đăng xuất an toàn

def clean_expired_sessions():
    """Tự động dọn dẹp các phiên đã quá hạn"""
    now = time.time()
    expired = [t for t, data in sessions.items() if now - data["last_active"] > SESSION_TIMEOUT_SECONDS]
    for t in expired:
        del sessions[t]

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if username and password:
        clean_expired_sessions()
        token = str(uuid.uuid4())
        sessions[token] = {
            "username": username,
            "last_active": time.time()
        }
        return jsonify({
            "status": "success",
            "message": "Đăng nhập thành công!",
            "token": token,
            "username": username,
            "expires_in": SESSION_TIMEOUT_SECONDS
        }), 200

    return jsonify({"status": "error", "message": "Vui lòng nhập tài khoản và mật khẩu!"}), 400

@app.route("/api/session-status", methods=["GET"])
def session_status():
    """Kiểm tra và tự động gia hạn phiên (Sliding Session) khi có request"""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    
    if not token or token in token_blacklist or token not in sessions:
        return jsonify({"status": "expired", "message": "Phiên đăng nhập đã hết hạn hoặc không hợp lệ!"}), 401

    now = time.time()
    session_data = sessions[token]

    # Kiểm tra quá 30 phút không hoạt động
    if now - session_data["last_active"] > SESSION_TIMEOUT_SECONDS:
        del sessions[token]
        return jsonify({"status": "expired", "message": "Phiên làm việc đã quá 30 phút không hoạt động!"}), 401

    # Gia hạn phiên tự động (Sliding session)
    session_data["last_active"] = now

    return jsonify({
        "status": "active",
        "username": session_data["username"],
        "remaining_seconds": SESSION_TIMEOUT_SECONDS
    }), 200

@app.route("/api/logout", methods=["POST"])
def logout():
    """Đăng xuất an toàn: Vô hiệu hóa token vĩnh viễn phía Server"""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token:
        token_blacklist.add(token)
        if token in sessions:
            del sessions[token]
    return jsonify({"status": "success", "message": "Đã hủy phiên làm việc an toàn trên server!"}), 200

@app.route("/api/diem-danh", methods=["POST"])
def diem_danh():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or token in token_blacklist or token not in sessions:
        return jsonify({"status": "expired", "message": "Phiên đăng nhập đã hết hạn!"}), 401
    
    # Reset thời hạn phiên khi người dùng gửi form
    sessions[token]["last_active"] = time.time()
    data = request.get_json() or {}
    
    return jsonify({
        "status": "success",
        "message": f"Đã lưu điểm danh cho lớp {data.get('class_name', '')} thành công!",
        "record": data
    }), 200

if __name__ == "__main__":
    print("🚀 Server SCRUM-20 (Python Flask) đang chạy tại: http://localhost:5000")
    app.run(port=5000, debug=True)
