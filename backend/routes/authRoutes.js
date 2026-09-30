const express = require('express');
const authController = require('../controllers/authController');
const roomController = require('../controllers/roomController');
const roomTypeController = require('../controllers/roomTypeController');
const requireAuth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

const router = express.Router();

router.get('/session', authController.getSession);
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/logout', authController.logout);
router.get('/home', requireAuth, authController.getHome);
router.get('/rooms', requireAuth, roomController.getRooms);
router.post('/rooms', requireAuth, upload.single('image'), roomController.addRoom);
router.put('/rooms/:id', requireAuth, upload.single('image'), roomController.updateRoom);
router.patch('/rooms/:id/status', requireAuth, roomController.updateStatus);
router.delete('/rooms/:id', requireAuth, roomController.deleteRoom);
router.get('/room-types', requireAuth, roomTypeController.getRoomTypes);
router.post('/room-types', requireAuth, roomTypeController.addRoomType);
router.put('/room-types/:code', requireAuth, roomTypeController.updateRoomType);
router.delete('/room-types/:code', requireAuth, roomTypeController.deleteRoomType);

module.exports = router;