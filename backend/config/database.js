const mysql = require('mysql2/promise');

const connectionConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hotel_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(connectionConfig);

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        room_code VARCHAR(30) NOT NULL,
        short_description TEXT NULL,
        image_path VARCHAR(255) NULL,
        room_type VARCHAR(80) NOT NULL,
        nightly_rate DECIMAL(12,2) NOT NULL,
        status ENUM('Phòng trống', 'Đã thuê', 'Bảo trì') NOT NULL DEFAULT 'Phòng trống',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rooms_code (room_code),
        CHECK (nightly_rate > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await pool.query('ALTER TABLE rooms MODIFY room_type VARCHAR(80) NOT NULL');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_types (
        code VARCHAR(16) NOT NULL,
        name VARCHAR(80) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (code),
        UNIQUE KEY uq_room_types_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    return true;
  } catch (error) {
    console.warn('MySQL chưa sẵn sàng, sẽ dùng lưu trữ dự phòng JSON:', error.message);
    return false;
  }
}

async function isDatabaseAvailable() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

module.exports = { initializeDatabase, isDatabaseAvailable, pool };
