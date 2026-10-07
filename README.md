# Hotel Manager

## Cau truc

- `backend/app.py`: Flask API, session, xu ly upload va ket noi MySQL/JSON.
- `backend/requirements.txt`: cac thu vien Python cua backend.
- `frontend/`: trang dang nhap, dashboard, CSS va JavaScript.
- `database/databasehotel.sql`: schema khoi dau cho MySQL.

## Chay ung dung

### Cach 1: tu terminal VS Code

```powershell
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
backend\.venv\Scripts\python.exe backend\app.py
```

Chay cac lenh tren tai thu muc goc project, sau do mo `http://localhost:3001`. Khong mo truc tiep file HTML bang `file://` hoac Live Server vi frontend can API de dang nhap va luu session.

### Cach 2: bang mot cu click

Mo file `start-server.cmd` trong thu muc project, hoac mo workspace trong VS Code va cho phep automatic task chay lan dau. Launcher tu kiem tra server, tao virtual environment va cai dependencies neu can, roi khoi dong app. Giu cua so server mo trong luc su dung; dong cua so nay se dung server. Can cai Python 3 tren may truoc khi chay.

Ung dung doc `backend/.env`. Ban local co the dung secret mac dinh chi danh cho development; khi deploy, dat `NODE_ENV=production` va cau hinh `SESSION_SECRET` trong Environment Variables cua hosting. Khong dua file `.env` len Git. Health check: `GET /health`.

### Dang nhap bang GitHub

Trong GitHub Developer settings, tao OAuth App va dat **Authorization callback URL** dung voi dia chi dang mo ung dung, vi du `http://127.0.0.1:3001/auth/github/callback` hoac `http://localhost:3001/auth/github/callback`. Hai dia chi nay khong thay the cho nhau; callback phai khop chinh xac voi host tren thanh dia chi trinh duyet. Them `GITHUB_CLIENT_ID` va `GITHUB_CLIENT_SECRET` vao `backend/.env`, sau do khoi dong lai backend. Khong chia se client secret va khong commit `.env`.

Tai khoan thu nghiem mac dinh khi chua co `backend/data/users.json`:

- Ten dang nhap: `admin`
- So dien thoai: `0900000000`
- Mat khau: `Admin@123`

Dang nhap hien tai ho tro ca ten dang nhap, email va so dien thoai; da them luong quen mat khau qua OTP (demo, tra ve ma OTP trong JSON de test local).

## Database

Chay `database/databasehotel.sql` tren MySQL 8 de tao database va cac bang roles, users, guests, rooms, reservations va payments. Ung dung hien tai van luu tai khoan trong `backend/data/users.json`; schema SQL la nen tang rieng, chua duoc noi vao API.

## API

- `POST /api/login`
- `POST /api/register`
- `POST /api/logout`
- `GET /api/session`
- `PUT /api/profile` (can dang nhap; cap nhat ho ten, ngay sinh, so dien thoai va anh dai dien; email khong the thay doi)
- `GET /api/home` (can dang nhap)
- `GET /api/rooms`, `POST /api/rooms`, `PUT /api/rooms/:id`, `PATCH /api/rooms/:id/status`, `DELETE /api/rooms/:id` (can dang nhap)
- `GET /api/room-types`, `POST /api/room-types`, `PUT /api/room-types/:code`, `DELETE /api/room-types/:code` (can dang nhap)
