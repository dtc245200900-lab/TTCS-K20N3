const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const dataDirectory = path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDirectory, 'users.json');

function readUsers() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(usersFile)) {
    const defaultUsers = [{
      id: 1,
      email: 'admin@hotel.local',
      passwordHash: bcrypt.hashSync('Admin@123', 12),
      fullName: 'Quản trị viên'
    }];
    saveUsers(defaultUsers);
    return defaultUsers;
  }
  return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}

function saveUsers(users) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

const users = readUsers();

function findByEmail(email) {
  return users.find((user) => user.email === email);
}

function createUser({ email, passwordHash, fullName }) {
  const user = {
    id: users.length ? Math.max(...users.map((item) => item.id)) + 1 : 1,
    email,
    passwordHash,
    fullName
  };
  users.push(user);
  saveUsers(users);
  return user;
}

module.exports = { findByEmail, createUser };