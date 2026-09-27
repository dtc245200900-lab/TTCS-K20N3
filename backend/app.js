const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const sessionMiddleware = require('./config/session');
const { initializeDatabase } = require('./config/database');
const authRoutes = require('./routes/authRoutes');

const app = express();
const frontendDirectory = path.join(__dirname, '..', 'frontend');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(sessionMiddleware);
app.use('/api', authRoutes);

app.get('/health', (request, response) => response.json({ status: 'ok' }));
app.get('/', (request, response) => response.redirect('/login.html'));
app.get('/home', (request, response) => {
  if (!request.session.user) return response.redirect('/login.html');
  response.sendFile(path.join(frontendDirectory, 'pages', 'home.html'));
});
app.use(express.static(frontendDirectory));

const port = process.env.PORT || 3000;

async function startServer() {
  await initializeDatabase();
  if (require.main === module) {
    app.listen(port, () => {
      console.log(`Hotel management app is running at http://localhost:${port}`);
    });
  }
}

startServer();

module.exports = app;