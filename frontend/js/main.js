const form = document.querySelector('#login-form');
let roomTypesCache = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

if (form) {
  const errorMessage = document.querySelector('#error-message');
  const successMessage = document.querySelector('#success-message');
  const fullNameGroup = document.querySelector('#full-name-group');
  const confirmPasswordGroup = document.querySelector('#confirm-password-group');
  const confirmPasswordInput = document.querySelector('#confirm-password');
  const authTitle = document.querySelector('#auth-title');
  const authSubtitle = document.querySelector('#auth-subtitle');
  const submitButton = document.querySelector('#submit-button');
  const passwordToggle = document.querySelector('#password-toggle');
  const passwordInput = document.querySelector('#password');
  let mode = 'login';

  passwordToggle.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    passwordToggle.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
    passwordToggle.textContent = showing ? '◉' : '⊙';
  });

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      button.dataset.mode = mode === 'login' ? 'register' : 'login';
      document.querySelectorAll('.tab-button').forEach((item) => item.classList.toggle('active', item === button));
      fullNameGroup.classList.toggle('hidden', mode === 'login');
      confirmPasswordGroup.classList.toggle('hidden', mode === 'login');
      document.querySelector('#full-name').required = mode === 'register';
      confirmPasswordInput.required = mode === 'register';
      authTitle.textContent = mode === 'login' ? 'Chào mừng trở lại.' : 'Tạo tài khoản mới.';
      authSubtitle.textContent = mode === 'login' ? 'Đăng nhập để tiếp tục vào không gian làm việc.' : 'Tạo tài khoản mới để bắt đầu sử dụng hệ thống.';
      submitButton.innerHTML = mode === 'login'
        ? '<span class="button-label">Đăng nhập</span><span class="button-arrow">→</span>'
        : '<span class="button-label">Tạo tài khoản</span><span class="button-arrow">→</span>';
      document.querySelector('#account-prompt').textContent = mode === 'login' ? 'Bạn chưa có tài khoản?' : 'Bạn đã có tài khoản?';
      button.textContent = mode === 'login' ? 'Tạo tài khoản' : 'Đăng nhập';
      errorMessage.textContent = '';
      successMessage.textContent = '';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    successMessage.textContent = '';
    const formData = new FormData(form);
    try {
      const response = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData))
      });
      const result = await response.json();
      if (!response.ok) {
        errorMessage.textContent = result.message || 'Không thể xử lý yêu cầu.';
        return;
      }
      if (mode === 'login') {
        window.location.href = '/home';
      } else {
        successMessage.textContent = result.message;
        form.reset();
        document.querySelector('[data-mode="login"]').click();
      }
    } catch {
      errorMessage.textContent = 'Không thể kết nối đến máy chủ.';
    }
  });
}

const logoutButton = document.querySelector('#logout-button');
if (logoutButton) {
  logoutButton.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const errorMessage = document.querySelector('#logout-error');
    button.disabled = true;
    errorMessage.textContent = '';
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể đăng xuất.');
      window.location.href = '/login.html';
    } catch (error) {
      errorMessage.textContent = error.message || 'Không thể kết nối đến máy chủ.';
      button.disabled = false;
    }
  });
}

async function loadRoomList() {
  const roomList = document.querySelector('#room-list');
  if (!roomList) return;

  try {
    const response = await fetch('/api/rooms');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách phòng.');

    if (!result.rooms || result.rooms.length === 0) {
      roomList.innerHTML = '<p class="muted">Chưa có phòng nào.</p>';
      return;
    }

    roomList.innerHTML = result.rooms.map((room) => {
      const statusClass = String(room.status || 'Phòng trống')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-');

      return `
        <div class="room-item">
          <div style="flex:1;">
            <strong>${room.roomCode}</strong>
            <small>${room.roomType} • ${room.shortDescription || 'Không có mô tả'}</small>
            <small>${Number(room.nightlyRate).toLocaleString('vi-VN')}đ / đêm</small>
          </div>
          <div class="room-meta">
            <span class="status-badge status-${statusClass}">${room.status}</span>
            <button type="button" class="delete-room-button" data-room-id="${room.id}">Xóa</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    roomList.innerHTML = `<p class="error">${error.message}</p>`;
  }
}

async function loadRoomTypes() {
  const roomTypeList = document.querySelector('#room-type-list');
  if (!roomTypeList) return;

  try {
    const response = await fetch('/api/room-types');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách thể loại phòng.');

    roomTypesCache = result.roomTypes || [];
    const select = document.querySelector('#room-type-select');
    if (select) {
      const selectedValue = select.value;
      select.innerHTML = '<option value="">-- Chọn loại phòng --</option>' + roomTypesCache
        .map((roomType) => `<option value="${escapeHtml(roomType.name)}">${escapeHtml(roomType.name)}</option>`)
        .join('');
      select.value = selectedValue;
    }

    document.querySelector('#room-type-code').value = result.nextCode || 'LP001';
    roomTypeList.innerHTML = roomTypesCache.length
      ? roomTypesCache.map((roomType) => `
        <div class="room-type-item">
          <span class="room-type-code">${escapeHtml(roomType.code)}</span>
          <strong>${escapeHtml(roomType.name)}</strong>
        </div>
      `).join('')
      : '<p class="muted">Chưa có thể loại phòng.</p>';
  } catch (error) {
    roomTypeList.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

const roomTypeForm = document.querySelector('#room-type-form');
if (roomTypeForm) {
  const toggleButton = document.querySelector('#toggle-room-type-form');
  const cancelButton = document.querySelector('#cancel-room-type-form');
  const codeInput = document.querySelector('#room-type-code');
  const nameInput = document.querySelector('#room-type-name');
  const errorMessage = document.querySelector('#room-type-error');
  const successMessage = document.querySelector('#room-type-message');

  toggleButton.addEventListener('click', () => {
    roomTypeForm.classList.remove('hidden-form');
    codeInput.value = roomTypesCache.length
      ? `LP${String(Math.max(...roomTypesCache.map((item) => Number(String(item.code).replace(/^LP/i, '')) || 0)) + 1).padStart(3, '0')}`
      : 'LP001';
    errorMessage.textContent = '';
    successMessage.textContent = '';
    nameInput.focus();
  });

  cancelButton.addEventListener('click', () => {
    roomTypeForm.reset();
    roomTypeForm.classList.add('hidden-form');
    errorMessage.textContent = '';
    successMessage.textContent = '';
  });

  roomTypeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    successMessage.textContent = '';
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) {
      errorMessage.textContent = 'Tên thể loại không được để trống.';
      nameInput.focus();
      return;
    }

    try {
      const response = await fetch('/api/room-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể thêm thể loại phòng.');

      roomTypeForm.reset();
      roomTypeForm.classList.add('hidden-form');
      successMessage.textContent = `${result.message} (${result.roomType.code})`;
      await loadRoomTypes();
    } catch (error) {
      errorMessage.textContent = error.message;
    }
  });
}

const roomList = document.querySelector('#room-list');
if (roomList) {
  roomList.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('.delete-room-button');
    if (!deleteButton) return;

    const roomMessage = document.querySelector('#room-list-message');
    const roomId = deleteButton.dataset.roomId;
    const roomCode = deleteButton.closest('.room-item').querySelector('strong').textContent;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa phòng ${roomCode}?`)) return;

    roomMessage.textContent = '';
    roomMessage.classList.remove('error');
    roomMessage.classList.add('success');
    deleteButton.disabled = true;

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể xóa phòng.');

      roomMessage.textContent = result.message || 'Xóa phòng thành công.';
      await loadRoomList();
    } catch (error) {
      roomMessage.textContent = error.message;
      roomMessage.classList.remove('success');
      roomMessage.classList.add('error');
      deleteButton.disabled = false;
    }
  });
}

const roomForm = document.querySelector('#room-form');
if (roomForm) {
  const roomMessage = document.querySelector('#room-message');
  const roomError = document.querySelector('#room-error');
  const toggleButton = document.querySelector('#toggle-room-form');

  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      roomForm.classList.toggle('hidden-form');
      toggleButton.textContent = roomForm.classList.contains('hidden-form') ? 'Thêm mới' : 'Ẩn form';
    });
  }

  roomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    roomMessage.textContent = '';
    roomError.textContent = '';

    const roomData = Object.fromEntries(new FormData(roomForm));

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roomData)
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Không thể thêm phòng.');
      }

      roomMessage.textContent = result.message;
      roomForm.reset();
      roomForm.classList.add('hidden-form');
      if (toggleButton) toggleButton.textContent = 'Thêm mới';
      await loadRoomList();
    } catch (error) {
      roomError.textContent = error.message;
    }
  });
}

async function loadSession() {
  if (!document.querySelector('#top-name')) return;
  try {
    const response = await fetch('/api/session');
    const result = await response.json();
    if (!result.user) {
      window.location.href = '/login.html';
      return;
    }
    const { user } = result;
    document.querySelector('#full-name').textContent = user.fullName;
    document.querySelector('#top-name').textContent = user.fullName;
    document.querySelector('#avatar').textContent = user.fullName.charAt(0).toUpperCase();
    await Promise.all([loadRoomList(), loadRoomTypes()]);
  } catch {
    window.location.href = '/login.html';
  }
}

loadSession();
// =========================================
// BL-05 - ROOM LIST
// =========================================

const rooms = [
  {
    roomNumber: 'P101',
    roomType: 'Phòng đơn',
    status: 'available',
    checkIn: '-',
    checkOut: '-'
  },

  {
    roomNumber: 'P102',
    roomType: 'Phòng đôi',
    status: 'occupied',
    checkIn: '14:00',
    checkOut: '12:00'
  },

  {
    roomNumber: 'P103',
    roomType: 'Phòng VIP',
    status: 'available',
    checkIn: '-',
    checkOut: '-'
  },

  {
    roomNumber: 'P104',
    roomType: 'Phòng đơn',
    status: 'occupied',
    checkIn: '15:00',
    checkOut: '11:30'
  },

  {
    roomNumber: 'P105',
    roomType: 'Phòng đôi',
    status: 'available',
    checkIn: '-',
    checkOut: '-'
  }
];

function renderRooms() {
  const roomGrid = document.querySelector('#room-grid');

  // Nếu đang ở trang login thì không làm gì
  if (!roomGrid) {
    return;
  }

  // Nếu không có phòng
  if (rooms.length === 0) {
    roomGrid.innerHTML = `
      <div class="room-empty">
        Chưa có phòng nào.
      </div>
    `;

    return;
  }

  // Hiển thị danh sách phòng
  roomGrid.innerHTML = rooms.map((room) => {

    const isAvailable = room.status === 'available';

    const statusText = isAvailable
      ? 'Phòng trống'
      : 'Đã có người thuê';

    return `
      <article class="room-card ${room.status}">

        <h3 class="room-number">
          ${room.roomNumber}
        </h3>

        <p class="room-type">
          ${room.roomType}
        </p>

        <span class="room-status ${room.status}">
          ${statusText}
        </span>

        <div class="room-time">

          <div class="room-time-item">
            <span>Giờ vào</span>
            <strong>${room.checkIn}</strong>
          </div>

          <div class="room-time-item">
            <span>Giờ ra</span>
            <strong>${room.checkOut}</strong>
          </div>

        </div>

      </article>
    `;
  }).join('');
}

renderRooms();