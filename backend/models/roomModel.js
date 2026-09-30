const fs = require('node:fs');
const path = require('node:path');
const { pool, isDatabaseAvailable } = require('../config/database');
const roomTypeModel = require('./roomTypeModel');

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
  const rawStatus = String(room.status || '').toLowerCase();
  const status = {
    available: 'Phòng trống',
    occupied: 'Đã thuê',
    'đã cho thuê': 'Đã thuê',
    maintenance: 'Bảo trì'
  }[rawStatus] || room.status || 'Phòng trống';

  return {
    id: room.id,
    roomCode: room.room_code || room.roomCode || room.roomNumber || '',
    shortDescription: room.short_description || room.shortDescription || '',
    imagePath: room.image_path || room.imagePath || '',
    roomType: room.room_type || room.roomType || 'Đơn',
    nightlyRate: Number(room.nightly_rate ?? room.nightlyRate ?? 0),
    status,
    checkInAt: room.checked_in_at || room.checkInAt || null,
    checkOutAt: room.checked_out_at || room.checkOutAt || null,
    createdAt: room.created_at || room.createdAt || null
  };
}

function normalizedStatus(status) {
  const value = String(status || '').trim().toLocaleLowerCase('vi');
  if (['available', 'phòng trống'].includes(value)) return 'Phòng trống';
  if (['occupied', 'đã thuê', 'đã cho thuê'].includes(value)) return 'Đã thuê';
  if (['maintenance', 'bảo trì'].includes(value)) return 'Bảo trì';
  return value;
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
  if (!await roomTypeModel.findRoomType(normalizedType)) throw new Error('Loại phòng không hợp lệ.');
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

async function updateRoom(id, { roomCode, shortDescription, imagePath, roomType, nightlyRate }) {
  const roomId = Number(id);
  if (!Number.isSafeInteger(roomId) || roomId <= 0) return { reason: 'not-found' };

  const normalizedCode = String(roomCode || '').trim();
  const normalizedDescription = String(shortDescription || '').trim();
  const normalizedType = String(roomType || '').trim();
  const normalizedRate = Number(nightlyRate);
  if (!/^[A-Za-z0-9-]{1,20}$/.test(normalizedCode)) throw new Error('Mã phòng chỉ gồm chữ cái, số hoặc dấu gạch ngang (tối đa 20 ký tự).');
  if (!normalizedDescription || normalizedDescription.length > 240) throw new Error('Mô tả phòng là bắt buộc và không quá 240 ký tự.');
  if (!normalizedType) throw new Error('Loại phòng không được để trống.');
  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) throw new Error('Giá thuê phải lớn hơn 0.');
  if (!await roomTypeModel.findRoomType(normalizedType)) throw new Error('Loại phòng không hợp lệ.');

  const databaseReady = await isDatabaseAvailable();
  if (databaseReady) {
    const [rows] = await pool.query('SELECT id, image_path FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    if (!rows.length) return { reason: 'not-found' };
    const [duplicates] = await pool.query('SELECT id FROM rooms WHERE room_code = ? AND id <> ? LIMIT 1', [normalizedCode, roomId]);
    if (duplicates.length) throw new Error('Mã phòng đã tồn tại.');

    await pool.query(
      'UPDATE rooms SET room_code = ?, short_description = ?, image_path = ?, room_type = ?, nightly_rate = ? WHERE id = ?',
      [normalizedCode, normalizedDescription, imagePath || rows[0].image_path || null, normalizedType, normalizedRate, roomId]
    );
    const [updatedRows] = await pool.query('SELECT * FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    return { room: normalizeRoom(updatedRows[0]) };
  }

  const rooms = readRooms();
  const room = rooms.find((item) => Number(item.id) === roomId);
  if (!room) return { reason: 'not-found' };
  if (rooms.some((item) => Number(item.id) !== roomId && String(item.roomCode || item.room_code || item.roomNumber || '').toLowerCase() === normalizedCode.toLowerCase())) {
    throw new Error('Mã phòng đã tồn tại.');
  }

  room.roomCode = normalizedCode;
  room.shortDescription = normalizedDescription;
  room.imagePath = imagePath || room.imagePath || room.image_path || '';
  room.roomType = normalizedType;
  room.nightlyRate = normalizedRate;
  saveRooms(rooms);
  return { room: normalizeRoom(room) };
}

async function updateRoomStatus(id, nextStatus) {
  const roomId = Number(id);
  if (!Number.isSafeInteger(roomId) || roomId <= 0) return { reason: 'not-found' };

  const requestedStatus = normalizedStatus(nextStatus);
  if (!['Phòng trống', 'Đã thuê'].includes(requestedStatus)) return { reason: 'invalid-status' };

  const databaseReady = await isDatabaseAvailable();
  if (databaseReady) {
    const [rows] = await pool.query('SELECT id, status FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    if (!rows.length) return { reason: 'not-found' };

    const currentStatus = normalizedStatus(rows[0].status);
    if (currentStatus === requestedStatus) return { room: null, unchanged: true };
    if (!['Phòng trống', 'Đã thuê'].includes(currentStatus)) return { reason: 'invalid-transition' };

    if (requestedStatus === 'Đã thuê') {
      await pool.query(
        'UPDATE rooms SET status = ?, checked_in_at = CURRENT_TIMESTAMP, checked_out_at = NULL WHERE id = ?',
        [requestedStatus, roomId]
      );
    } else {
      await pool.query(
        'UPDATE rooms SET status = ?, checked_out_at = CURRENT_TIMESTAMP WHERE id = ?',
        [requestedStatus, roomId]
      );
    }

    const [updatedRows] = await pool.query('SELECT * FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    return { room: normalizeRoom(updatedRows[0]) };
  }

  const rooms = readRooms();
  const room = rooms.find((item) => Number(item.id) === roomId);
  if (!room) return { reason: 'not-found' };

  const currentStatus = normalizedStatus(room.status);
  if (currentStatus === requestedStatus) return { room: normalizeRoom(room), unchanged: true };
  if (!['Phòng trống', 'Đã thuê'].includes(currentStatus)) return { reason: 'invalid-transition' };

  room.status = requestedStatus;
  if (requestedStatus === 'Đã thuê') {
    room.checkInAt = new Date().toISOString();
    room.checkOutAt = null;
  } else {
    room.checkOutAt = new Date().toISOString();
  }
  saveRooms(rooms);
  return { room: normalizeRoom(room) };
}

async function deleteRoom(id) {
  const roomId = Number(id);
  if (!Number.isSafeInteger(roomId) || roomId <= 0) {
    return { deleted: false, reason: 'not-found' };
  }

  const databaseReady = await isDatabaseAvailable();

  if (databaseReady) {
    const [rows] = await pool.query('SELECT id, status FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    if (!rows.length) return { deleted: false, reason: 'not-found' };
    if (['đã thuê', 'đang thuê', 'rented', 'occupied'].includes(String(rows[0].status).toLowerCase())) {
      return { deleted: false, reason: 'rented' };
    }

    const [result] = await pool.query(
      'DELETE FROM rooms WHERE id = ? AND LOWER(status) NOT IN (?, ?, ?, ?)',
      [roomId, 'đã thuê', 'đang thuê', 'rented', 'occupied']
    );
    if (result.affectedRows) return { deleted: true };

    const [remainingRows] = await pool.query('SELECT id, status FROM rooms WHERE id = ? LIMIT 1', [roomId]);
    return remainingRows.length
      ? { deleted: false, reason: 'rented' }
      : { deleted: false, reason: 'not-found' };
  }

  const rooms = readRooms();
  const roomIndex = rooms.findIndex((room) => Number(room.id) === roomId);
  if (roomIndex === -1) return { deleted: false, reason: 'not-found' };
  if (['đã thuê', 'đang thuê', 'rented', 'occupied'].includes(String(rooms[roomIndex].status || '').toLowerCase())) {
    return { deleted: false, reason: 'rented' };
  }

  rooms.splice(roomIndex, 1);
  saveRooms(rooms);
  return { deleted: true };
}

module.exports = { createRoom, deleteRoom, findByRoomCode, listRooms, updateRoom, updateRoomStatus };
