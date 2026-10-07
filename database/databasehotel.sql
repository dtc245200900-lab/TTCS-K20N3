CREATE DATABASE IF NOT EXISTS hotel_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hotel_management;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
);

CREATE TABLE IF NOT EXISTS guests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(254),
  phone VARCHAR(30),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_guests_email (email)
);

CREATE TABLE IF NOT EXISTS rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_code VARCHAR(30) NOT NULL,
  short_description TEXT NULL,
  image_path VARCHAR(255) NULL,
  room_type VARCHAR(80) NOT NULL,
  nightly_rate DECIMAL(12, 2) NOT NULL CHECK (nightly_rate > 0),
  status ENUM('Phòng trống', 'Đã đặt', 'Đã thuê', 'Đang dọn phòng', 'Bảo trì') NOT NULL DEFAULT 'Phòng trống',
  checked_in_at DATETIME NULL,
  checked_out_at DATETIME NULL,
  rental_duration_seconds BIGINT UNSIGNED NULL,
  rental_duration_minutes BIGINT UNSIGNED NULL,
  rental_days INT NULL,
  rental_total DECIMAL(14, 2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rooms_code (room_code)
);

CREATE TABLE IF NOT EXISTS room_types (
  code VARCHAR(16) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description TEXT NULL,
  nightly_rate DECIMAL(12, 2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  UNIQUE KEY uq_room_types_name (name)
);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  scheduled_check_in_at DATETIME NOT NULL,
  scheduled_check_out_at DATETIME NOT NULL,
  status ENUM('pending', 'checked_in', 'checked_out', 'cancelled') NOT NULL DEFAULT 'pending',
  actual_check_in_at DATETIME NULL,
  actual_check_out_at DATETIME NULL,
  cleaning_until DATETIME NULL,
  duration_minutes BIGINT UNSIGNED NULL,
  rental_total DECIMAL(14, 2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_room_status (room_id, status, scheduled_check_in_at),
  KEY idx_bookings_cleaning_until (cleaning_until),
  CONSTRAINT fk_bookings_room FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS rental_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  checked_in_at DATETIME NOT NULL,
  scheduled_check_out_at DATETIME NULL,
  returned_at DATETIME NOT NULL,
  duration_minutes BIGINT UNSIGNED NOT NULL,
  rental_total DECIMAL(14, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rental_history_room (room_id, created_at),
  CONSTRAINT fk_rental_history_room FOREIGN KEY (room_id) REFERENCES rooms (id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guest_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  status ENUM('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reservations_dates (check_in, check_out),
  CONSTRAINT fk_reservations_guest FOREIGN KEY (guest_id) REFERENCES guests (id),
  CONSTRAINT fk_reservations_room FOREIGN KEY (room_id) REFERENCES rooms (id),
  CONSTRAINT chk_reservations_dates CHECK (check_out > check_in)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  method ENUM('cash', 'card', 'transfer') NOT NULL,
  status ENUM('pending', 'paid', 'refunded') NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_reservation (reservation_id),
  CONSTRAINT fk_payments_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0)
);

INSERT IGNORE INTO roles (name) VALUES ('admin'), ('receptionist');