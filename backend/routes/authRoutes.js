const express = require('express');
const authController = require('../controllers/authController');
const roomController = require('../controllers/roomController');
const roomTypeController = require('../controllers/roomTypeController');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.get('/session', authController.getSession);
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/logout', authController.logout);
router.get('/home', requireAuth, authController.getHome);
router.get('/rooms', requireAuth, roomController.getRooms);
router.post('/rooms', requireAuth, roomController.addRoom);
router.delete('/rooms/:id', requireAuth, roomController.deleteRoom);
router.get('/room-types', requireAuth, roomTypeController.getRoomTypes);
router.post('/room-types', requireAuth, roomTypeController.addRoomType);

module.exports = router;