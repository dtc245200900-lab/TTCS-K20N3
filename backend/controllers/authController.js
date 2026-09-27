const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName
  };
}

function login(request, response) {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  if (!email || !password) {
    return response.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' });
  }

  const user = userModel.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return response.status(401).json({ message: 'Email hoặc mật khẩu không chính xác.' });
  }

  request.session.regenerate((error) => {
    if (error) return response.status(500).json({ message: 'Không thể tạo phiên đăng nhập.' });
    request.session.user = publicUser(user);
    request.session.save((saveError) => {
      if (saveError) return response.status(500).json({ message: 'Không thể lưu phiên đăng nhập.' });
      response.json({ message: 'Đăng nhập thành công.', user: request.session.user });
    });
  });
}

function register(request, response) {
  const fullName = String(request.body.fullName || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const confirmPassword = String(request.body.confirmPassword || '');

  if (fullName.length < 2 || !email || password.length < 8) {
    return response.status(400).json({
      message: 'Vui lòng nhập họ tên, email hợp lệ và mật khẩu tối thiểu 8 ký tự.'
    });
  }
  if (password !== confirmPassword) {
    return response.status(400).json({ message: 'Mật khẩu xác nhận không trùng khớp.' });
  }
  if (userModel.findByEmail(email)) {
    return response.status(409).json({ message: 'Email này đã được sử dụng.' });
  }

  try {
    const user = userModel.createUser({
      email,
      passwordHash: bcrypt.hashSync(password, 12),
      fullName
    });
    response.status(201).json({
      message: 'Tạo tài khoản thành công. Bạn có thể đăng nhập ngay.',
      user: publicUser(user)
    });
  } catch {
    response.status(500).json({ message: 'Không thể lưu tài khoản.' });
  }
}

function logout(request, response) {
  request.session.destroy((error) => {
    if (error) return response.status(500).json({ message: 'Không thể đăng xuất.' });
    response.clearCookie('connect.sid', { path: '/' });
    response.json({ message: 'Đăng xuất thành công.' });
  });
}

function getSession(request, response) {
  response.json({ user: request.session.user || null });
}

function getHome(request, response) {
  response.json({ message: 'Bạn đã truy cập trang chủ.', user: request.session.user });
}

module.exports = { getHome, getSession, login, logout, register };