const fs = require('node:fs');
const path = require('node:path');
const { pool, isDatabaseAvailable } = require('../config/database');

const dataDirectory = path.join(__dirname, '..', 'data');
const roomTypesFile = path.join(dataDirectory, 'room-types.json');
const defaultNames = ['Đơn', 'Đôi', 'VIP'];

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function readRoomTypes() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(roomTypesFile)) {
    fs.writeFileSync(roomTypesFile, '[]');
    return [];
  }

  const roomTypes = JSON.parse(fs.readFileSync(roomTypesFile, 'utf8'));
  if (!Array.isArray(roomTypes)) throw new Error('Dữ liệu loại phòng không hợp lệ.');
  return roomTypes;
}

function saveRoomTypes(roomTypes) {
  fs.writeFileSync(roomTypesFile, JSON.stringify(roomTypes, null, 2));
}

function nextCode(roomTypes) {
  const highestNumber = roomTypes.reduce((highest, roomType) => {
    const match = String(roomType.code || '').match(/^LP(\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `LP${String(highestNumber + 1).padStart(3, '0')}`;
}

async function seedDatabaseTypes() {
  const [roomRows] = await pool.query('SELECT DISTINCT room_type FROM rooms');
  const [typeRows] = await pool.query('SELECT code, name FROM room_types ORDER BY code');
  const roomTypes = typeRows.map((row) => ({ code: row.code, name: row.name }));
  const names = [...defaultNames, ...roomRows.map((row) => row.room_type)];

  for (const name of names) {
    if (!String(name || '').trim() || roomTypes.some((item) => normalizeName(item.name) === normalizeName(name))) continue;
    const code = nextCode(roomTypes);
    try {
      await pool.query('INSERT INTO room_types (code, name) VALUES (?, ?)', [code, String(name).trim()]);
      roomTypes.push({ code, name: String(name).trim() });
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
  }

  const [updatedRows] = await pool.query('SELECT code, name FROM room_types ORDER BY code');
  return updatedRows;
}

async function listRoomTypes() {
  if (await isDatabaseAvailable()) {
    const rows = await seedDatabaseTypes();
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  const roomTypes = readRoomTypes();
  let roomNames = [];
  const roomsFile = path.join(dataDirectory, 'rooms.json');
  if (fs.existsSync(roomsFile)) {
    const rooms = JSON.parse(fs.readFileSync(roomsFile, 'utf8'));
    if (Array.isArray(rooms)) roomNames = rooms.map((room) => room.roomType || room.room_type);
  }

  for (const name of [...defaultNames, ...roomNames]) {
    if (!String(name || '').trim() || roomTypes.some((item) => normalizeName(item.name) === normalizeName(name))) continue;
    roomTypes.push({ code: nextCode(roomTypes), name: String(name).trim() });
  }

  saveRoomTypes(roomTypes);
  return roomTypes;
}

async function createRoomType(name) {
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!normalizedName) throw new Error('Tên thể loại không được để trống.');

  const roomTypes = await listRoomTypes();
  if (roomTypes.some((item) => normalizeName(item.name) === normalizeName(normalizedName))) {
    throw new Error('Tên thể loại đã tồn tại.');
  }

  const code = nextCode(roomTypes);
  if (await isDatabaseAvailable()) {
    await pool.query('INSERT INTO room_types (code, name) VALUES (?, ?)', [code, normalizedName]);
  } else {
    roomTypes.push({ code, name: normalizedName });
    saveRoomTypes(roomTypes);
  }

  return { code, name: normalizedName };
}

async function findRoomType(name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;
  const roomTypes = await listRoomTypes();
  return roomTypes.find((item) => normalizeName(item.name) === normalizedName) || null;
}

module.exports = { createRoomType, findRoomType, listRoomTypes };