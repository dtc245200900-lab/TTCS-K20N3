module.exports = (request, response, next) => {
  if (!request.session.user) {
    return response.status(401).json({ message: 'Bạn cần đăng nhập để tiếp tục.' });
  }
  next();
};