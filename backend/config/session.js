const session = require('express-session');

const sessionSecret = process.env.SESSION_SECRET || (
  process.env.NODE_ENV === 'production'
    ? ''
    : 'local-only-session-secret-change-before-production'
);

if (!sessionSecret) {
  throw new Error('SESSION_SECRET is required when NODE_ENV=production.');
}

module.exports = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
});