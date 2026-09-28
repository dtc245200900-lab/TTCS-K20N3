const roomTypeModel = require('../models/roomTypeModel');

async function getRoomTypes(request, response) {
  try {
    const roomTypes = await roomTypeModel.listRoomTypes();
    const highestNumber = roomTypes.reduce((highest, roomType) => {
      const match = String(roomType.code).match(/^LP(\d+)$/i);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return response.json({
      roomTypes,
      nextCode: `LP${String(highestNumber + 1).padStart(3, '0')}`
    });
  } catch (error) {
    return response.status(500).json({ message: error.message || 'Không thể tải danh sách thể loại phòng.' });
  }
}

async function addRoomType(request, response) {
  const name = String(request.body.name || '').trim();
  if (!name) return response.status(400).json({ message: 'Tên thể loại không được để trống.' });

  try {
    const roomType = await roomTypeModel.createRoomType(name);
    return response.status(201).json({ message: 'Thêm thể loại phòng thành công.', roomType });
  } catch (error) {
    const isDuplicate = error.code === 'ER_DUP_ENTRY';
    return response.status(isDuplicate ? 409 : 400).json({
      message: isDuplicate ? 'Tên thể loại đã tồn tại.' : error.message || 'Không thể thêm thể loại phòng.'
    });
  }
}

module.exports = { addRoomType, getRoomTypes };