const fs = require('node:fs');
const path = require('node:path');
const { pool, isDatabaseAvailable } = require('../config/database');

const dataDirectory = path.join(__dirname, '..', 'data');
const roomsFile = path.join(dataDirectory, 'rooms.json');

function saveRooms(rooms) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(roomsFile, JSON.stringify(rooms, null, 2));
}

function readRooms() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!fs.existsSync(roomsFile)) {
    saveRooms([]);
    return [];
  }

  try {
    const rooms = JSON.parse(fs.readFileSync(roomsFile, 'utf8'));
    return Array.isArray(rooms) ? rooms : [];
  } catch {
    saveRooms([]);
    return [];
  }
}

function normalizeRoom(room) {
  return {
    id: room.id,
    roomCode: room.room_code || room.roomCode || room.roomNumber || '',
    shortDescription: room.short_description || room.shortDescription || '',
    imagePath: room.image_path || room.imagePath || '',
    roomType: room.room_type || room.roomType || 'Đơn',
    nightlyRate: Number(room.nightly_rate ?? room.nightlyRate ?? 0),
    status: room.status || 'Phòng trống',
    createdAt: room.created_at || room.createdAt || null
  };
}

async function listRooms() {
  const databaseReady = await isDatabaseAvailable();

  if (databaseReady) {
    const [rows] = await pool.query('SELECT * FROM rooms ORDER BY created_at DESC');
    return rows.map((row) => normalizeRoom(row));
  }

  const rooms = readRooms();
  return rooms.map((room) => normalizeRoom(room));
}

async function findByRoomCode(roomCode) {
  const databaseReady = await isDatabaseAvailable();

  if (databaseReady) {
    const [rows] = await pool.query('SELECT * FROM rooms WHERE room_code = ? LIMIT 1', [String(roomCode).trim()]);
    return rows.length ? normalizeRoom(rows[0]) : null;
  }

  const rooms = readRooms();
  const normalizedCode = String(roomCode || '').trim();
  return rooms.find((room) => String(room.roomCode || room.room_code || '').toLowerCase() === normalizedCode.toLowerCase()) || null;
}

async function createRoom({ roomCode, shortDescription, imagePath, roomType, nightlyRate, status = 'Phòng trống' }) {
  const normalizedCode = String(roomCode || '').trim();
  const normalizedDescription = String(shortDescription || '').trim();
  const normalizedImagePath = String(imagePath || '').trim();
  const normalizedType = String(roomType || '').trim();
  const normalizedRate = Number(nightlyRate);
  const normalizedStatus = String(status || 'Phòng trống').trim();

  if (!normalizedCode) throw new Error('Mã phòng không được để trống.');
  if (!normalizedType) throw new Error('Loại phòng không được để trống.');
  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) throw new Error('Giá thuê phải lớn hơn 0.');
  if (!['Đơn', 'Đôi', 'VIP'].includes(normalizedType)) throw new Error('Loại phòng không hợp lệ.');
  if (!['Phòng trống', 'Đã thuê', 'Bảo trì'].includes(normalizedStatus)) throw new Error('Trạng thái phòng không hợp lệ.');

  const duplicate = await findByRoomCode(normalizedCode);
  if (duplicate) throw new Error('Mã phòng đã tồn tại.');

  const databaseReady = await isDatabaseAvailable();

  if (databaseReady) {
    const [result] = await pool.query(
      'INSERT INTO rooms (room_code, short_description, image_path, room_type, nightly_rate, status) VALUES (?, ?, ?, ?, ?, ?)',
      [normalizedCode, normalizedDescription, normalizedImagePath || null, normalizedType, normalizedRate, normalizedStatus]
    );

    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [result.insertId]);
    return normalizeRoom(rows[0]);
  }

  const rooms = readRooms();
  const room = {
    id: rooms.length ? Math.max(...rooms.map((item) => item.id || 0)) + 1 : 1,
    roomCode: normalizedCode,
    shortDescription: normalizedDescription,
    imagePath: normalizedImagePath,
    roomType: normalizedType,
    nightlyRate: normalizedRate,
    status: normalizedStatus
  };

  rooms.push(room);
  saveRooms(rooms);
  return normalizeRoom(room);
}

module.exports = { createRoom, findByRoomCode, listRooms };
