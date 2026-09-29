const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const uploadDirectory = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const baseName = (path.basename(file.originalname || 'room', extension) || 'room')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-_]+/g, '')
      .slice(0, 50) || 'room';
    callback(null, `${Date.now()}-${baseName}${extension}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_request, file, callback) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error('Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF.'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

module.exports = upload;
