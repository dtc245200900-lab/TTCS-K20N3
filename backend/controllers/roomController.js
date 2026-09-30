const roomModel = require('../models/roomModel');

async function getRooms(request, response) {
  try {
    const rooms = await roomModel.listRooms();
    return response.json({ rooms });
  } catch (error) {
    return response.status(500).json({ message: error.message || 'Không thể tải danh sách phòng.' });
  }
}

async function addRoom(request, response) {
  const roomCode = String(request.body.roomCode || '').trim();
  const shortDescription = String(request.body.shortDescription || '').trim();
  const roomType = String(request.body.roomType || '').trim();
  const nightlyRate = Number(request.body.nightlyRate);
  const status = 'Phòng trống';
  const imagePath = request.file ? `/uploads/${request.file.filename}` : '';

  if (!/^[A-Za-z0-9-]+$/.test(roomCode) || shortDescription.length > 240 || !roomCode || !roomType || !shortDescription || !Number.isFinite(nightlyRate) || nightlyRate <= 0) {
    return response.status(400).json({
      message: 'Vui lòng nhập đầy đủ mã phòng, mô tả, thể loại và giá thuê > 0.'
    });
  }

  try {
    const room = await roomModel.createRoom({
      roomCode,
      shortDescription,
      imagePath,
      roomType,
      nightlyRate,
      status
    });

    return response.status(201).json({
      message: 'Thêm phòng thành công.',
      room
    });
  } catch (error) {
    return response.status(400).json({
      message: error.message || 'Không thể thêm phòng.'
    });
  }
}

async function updateRoom(request, response) {
  const roomCode = String(request.body.roomCode || '').trim();
  const shortDescription = String(request.body.shortDescription || '').trim();
  const roomType = String(request.body.roomType || '').trim();
  const nightlyRate = Number(request.body.nightlyRate);
  const imagePath = request.file ? `/uploads/${request.file.filename}` : '';

  if (!/^[A-Za-z0-9-]{1,20}$/.test(roomCode) || shortDescription.length > 240 || !shortDescription || !roomType || !Number.isFinite(nightlyRate) || nightlyRate <= 0) {
    return response.status(400).json({ message: 'Vui lòng nhập mã phòng hợp lệ, mô tả (tối đa 240 ký tự), thể loại và giá thuê > 0.' });
  }

  try {
    const result = await roomModel.updateRoom(request.params.id, {
      roomCode,
      shortDescription,
      imagePath,
      roomType,
      nightlyRate
    });
    if (result.reason === 'not-found') return response.status(404).json({ message: 'Không tìm thấy phòng.' });
    return response.json({ message: 'Cập nhật thông tin phòng thành công.', room: result.room });
  } catch (error) {
    return response.status(400).json({ message: error.message || 'Không thể cập nhật thông tin phòng.' });
  }
}

async function updateStatus(request, response) {
  try {
    const result = await roomModel.updateRoomStatus(request.params.id, request.body.status);
    if (result.reason === 'not-found') {
      return response.status(404).json({ message: 'Không tìm thấy phòng.' });
    }
    if (result.reason === 'invalid-status' || result.reason === 'invalid-transition') {
      return response.status(409).json({ message: 'Trạng thái phòng không hợp lệ.' });
    }
    if (result.unchanged) {
      return response.json({ message: 'Trạng thái phòng không thay đổi.', room: result.room });
    }
    return response.json({ message: 'Cập nhật trạng thái phòng thành công.', room: result.room });
  } catch (error) {
    return response.status(500).json({ message: error.message || 'Không thể cập nhật trạng thái phòng.' });
  }
}

async function deleteRoom(request, response) {
  try {
    const result = await roomModel.deleteRoom(request.params.id);

    if (!result.deleted) {
      if (result.reason === 'rented') {
        return response.status(409).json({ message: 'Không thể xóa phòng đang được thuê.' });
      }
      return response.status(404).json({ message: 'Không tìm thấy phòng cần xóa.' });
    }

    return response.json({ message: 'Xóa phòng thành công.' });
  } catch (error) {
    return response.status(409).json({
      message: error.code === 'ER_ROW_IS_REFERENCED_2'
        ? 'Không thể xóa phòng đang có dữ liệu đặt phòng.'
        : error.message || 'Không thể xóa phòng.'
    });
  }
}

module.exports = { addRoom, deleteRoom, getRooms, updateRoom, updateStatus };
