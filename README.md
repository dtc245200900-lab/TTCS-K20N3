# Hotel Manager

## Cau truc

- `backend/`: Express API, controllers, models, routes, middleware va session config.
- `frontend/`: trang dang nhap, dashboard, CSS va JavaScript.
- `database/databasehotel.sql`: schema khoi dau cho MySQL.

## Chay ung dung

### Cach 1: tu terminal VS Code

```powershell
npm install
npm start
```

Chay cac lenh tren tai thu muc goc project, sau do mo `http://localhost:3000`. Khong mo truc tiep file HTML bang `file://` hoac Live Server vi frontend can Express API de dang nhap va luu session. Neu muon chay rieng backend, dung `npm install` va `npm start` trong `backend/`.

### Cach 2: bang mot cu click

Mo file `start-server.cmd` trong thu muc project. Cua so den phai duoc giu mo trong luc su dung app; dong cua so nay se dung server. Khi mo lai may hoac mo lai VS Code, chi can chay lai file nay.

Ung dung doc `backend/.env`. Ban local co the dung secret mac dinh chi danh cho development; khi deploy, dat `NODE_ENV=production` va cau hinh `SESSION_SECRET` trong Environment Variables cua hosting. Khong dua file `.env` len Git. Health check: `GET /health`.

Tai khoan thu nghiem mac dinh khi chua co `backend/data/users.json`:

- Email: `admin@hotel.local`
- Mat khau: `Admin@123`

## Database

Chay `database/databasehotel.sql` tren MySQL 8 de tao database va cac bang roles, users, guests, rooms, reservations va payments. Ung dung hien tai van luu tai khoan trong `backend/data/users.json`; schema SQL la nen tang rieng, chua duoc noi vao API.

## API

- `POST /api/login`
- `POST /api/register`
- `POST /api/logout`
- `GET /api/session`
- `GET /api/home` (can dang nhap)
