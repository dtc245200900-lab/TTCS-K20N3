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

Tai khoan thu nghiem mac dinh khi chua co `backend/data/users.json`:

- Email: `admin@hotel.local`
- Mat khau: `Admin@123`

## Dang ky va dang nhap bang Google, Microsoft, GitHub

`Dang ky ngay` mo form dang ky rieng bang ho ten, email va mat khau toi thieu 8 ky tu. Cac nut Google, Microsoft va GitHub can OAuth credentials; khi chua cau hinh, trang se hien thong bao va form email/mat khau van dung binh thuong.

1. Tao OAuth application tai Google Cloud Console, Microsoft Entra admin center va GitHub Developer Settings.
2. Khai bao callback URL cho tung ung dung:
	- Google: `http://localhost:3001/auth/google/callback`
	- Microsoft: `http://localhost:3001/auth/microsoft/callback`
	- GitHub: `http://localhost:3001/auth/github/callback`
3. Copy `backend/.env.example` thanh `backend/.env`, sau do dien client ID va client secret tu tung nha cung cap. Microsoft co the de `MICROSOFT_TENANT_ID=common` hoac thay bang tenant ID cua to chuc.
4. Khoi dong lai `start-server.cmd` de nap credentials.

Google can OAuth consent screen va scope `openid email profile`. Microsoft can delegated permission `User.Read`. GitHub can scope `read:user user:email`. Khi deploy, thay `localhost` trong callback URL bang domain HTTPS that va khai bao lai URL do trong ca ba developer console.

Khong commit `backend/.env` va khong gui client secret qua chat. Neu email da co tai khoan password, OAuth se yeu cau dang nhap bang tai khoan cu; he thong khong tu dong gop tai khoan.

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
