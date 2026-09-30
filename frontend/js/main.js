const form = document.querySelector('#login-form');
let roomTypesCache = [];
let roomCache = [];
let openRoomForm;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function roomTypeLabel(name) {
  return { Đơn: 'Phòng đơn', Đôi: 'Phòng đôi', VIP: 'VIP' }[name] || name;
}

function roomStatusInfo(status) {
  const normalized = String(status || '')
    .trim()
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, '-');

  if (['available', 'phong-trong'].includes(normalized)) {
    return { className: 'available', label: 'PHÒNG TRỐNG' };
  }
  if (['occupied', 'da-thue', 'da-co-nguoi-thue'].includes(normalized)) {
    return { className: 'occupied', label: 'ĐÃ CHO THUÊ' };
  }
  return { className: 'maintenance', label: String(status || 'Chưa cập nhật').toLocaleUpperCase('vi') };
}

function formatRoomTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
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
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData))
      });
      const result = await response.json();
      if (!response.ok) {
        errorMessage.textContent = result.message || 'Không thể xử lý yêu cầu.';
        return;
      }
      if (mode === 'login') {
        window.location.assign('/home');
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
  const roomGrid = document.querySelector('#room-grid');
  if (!roomGrid) return;
  const roomCount = document.querySelector('#room-count');

  try {
    const response = await fetch('/api/rooms');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách phòng.');

    if (!result.rooms || result.rooms.length === 0) {
      roomCache = [];
      if (roomCount) roomCount.textContent = '0 phòng';
      roomGrid.innerHTML = '<div class="room-empty">Chưa có phòng nào.</div>';
      return;
    }

    if (roomCount) roomCount.textContent = `${result.rooms.length} phòng`;
    roomCache = result.rooms;

    roomGrid.innerHTML = result.rooms.map((room) => {
      const status = roomStatusInfo(room.status);
      const roomCode = room.roomCode || room.room_code || room.roomNumber || '';
      const roomType = room.roomType || room.room_type || '';
      const shortDescription = room.shortDescription ?? room.short_description ?? '';
      const nightlyRate = Number(room.nightlyRate ?? room.nightly_rate);
      const imagePath = room.imagePath || room.image_path || '/assets/room-placeholder.svg';
      const checkIn = status.className === 'occupied'
        ? formatRoomTime(room.checkInAt || room.checked_in_at)
        : '--:--';
      const checkOut = status.className === 'occupied'
        ? formatRoomTime(room.checkOutAt || room.checked_out_at)
        : '--:--';
      const priceLabel = Number.isFinite(nightlyRate)
        ? `${nightlyRate.toLocaleString('vi-VN')}đ / đêm`
        : '';
      const statusAction = status.className === 'occupied'
        ? { nextStatus: 'available', label: 'Trả phòng' }
        : status.className === 'available'
          ? { nextStatus: 'occupied', label: 'Cho thuê' }
          : null;

      return `
        <article class="room-card ${status.className}">
          <img class="room-card-image" src="${escapeHtml(imagePath)}" alt="Ảnh phòng ${escapeHtml(roomCode)}" onerror="this.onerror=null;this.src='/assets/room-placeholder.svg'">
          <div class="room-card-content">
            <h3 class="room-number">${escapeHtml(roomCode)}</h3>
            <p class="room-type">${escapeHtml(roomTypeLabel(roomType))}</p>
            <p class="room-description">${escapeHtml(shortDescription)}</p>
            <p class="room-price">${escapeHtml(priceLabel)}</p>
            <span class="room-status ${status.className}">${escapeHtml(status.label)}</span>
            <div class="room-time">
              <div class="room-time-item"><span>Giờ vào</span><strong>${escapeHtml(checkIn)}</strong></div>
              <div class="room-time-item"><span>Giờ ra</span><strong>${escapeHtml(checkOut)}</strong></div>
            </div>
            <div class="room-meta">
              <button type="button" class="edit-room-button" data-room-id="${escapeHtml(room.id)}">Cập nhật thông tin</button>
              ${statusAction ? `<button type="button" class="room-status-toggle ${status.className}" data-room-id="${escapeHtml(room.id)}" data-next-status="${statusAction.nextStatus}">${statusAction.label}</button>` : ''}
              <button type="button" class="delete-room-button" data-room-id="${escapeHtml(room.id)}">Xóa</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  } catch (error) {
    roomGrid.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
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
    const roomTypeSelect = document.querySelector('#room-type-select');
    if (roomTypeSelect) {
      const selectedValue = roomTypeSelect.value;
      roomTypeSelect.innerHTML = '<option value="">-- Chọn loại phòng --</option>' + roomTypesCache
        .map((roomType) => `<option value="${escapeHtml(roomType.name)}">${escapeHtml(roomTypeLabel(roomType.name))}</option>`)
        .join('');
      roomTypeSelect.value = selectedValue;
    }

    document.querySelector('#room-type-code').value = result.nextCode || 'LP001';
    roomTypeList.innerHTML = roomTypesCache.length
      ? roomTypesCache.map((roomType) => `
        <div class="room-type-item">
          <span class="room-type-code">${escapeHtml(roomType.code)}</span>
          <strong>${escapeHtml(roomTypeLabel(roomType.name))}</strong>
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

const roomGrid = document.querySelector('#room-grid');
if (roomGrid) {
  roomGrid.addEventListener('click', async (event) => {
    const editButton = event.target.closest('.edit-room-button');
    if (editButton) {
      const room = roomCache.find((item) => String(item.id) === editButton.dataset.roomId);
      if (room) openRoomForm(room);
      return;
    }

    const statusButton = event.target.closest('.room-status-toggle');
    if (statusButton) {
      const roomMessage = document.querySelector('#room-list-message');
      statusButton.disabled = true;
      roomMessage.textContent = '';
      roomMessage.classList.remove('error');
      roomMessage.classList.add('success');

      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(statusButton.dataset.roomId)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: statusButton.dataset.nextStatus })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Không thể cập nhật trạng thái phòng.');

        roomMessage.textContent = result.message;
        await loadRoomList();
      } catch (error) {
        roomMessage.textContent = error.message;
        roomMessage.classList.remove('success');
        roomMessage.classList.add('error');
        statusButton.disabled = false;
      }
      return;
    }

    const deleteButton = event.target.closest('.delete-room-button');
    if (!deleteButton) return;

    const roomMessage = document.querySelector('#room-list-message');
    const roomId = deleteButton.dataset.roomId;
    const roomCode = deleteButton.closest('.room-card').querySelector('.room-number').textContent;
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
  const navigationButtons = document.querySelectorAll('[data-room-view]');
  const roomViews = {
    list: document.querySelector('#room-list-view'),
    add: document.querySelector('#room-add-view'),
    types: document.querySelector('#room-types-view')
  };
  const roomMessage = document.querySelector('#room-message');
  const roomError = document.querySelector('#room-error');
  const cancelButton = document.querySelector('#cancel-room-form');
  const imageInput = document.querySelector('#room-image');
  const imagePreview = document.querySelector('#image-preview');
  const descriptionInput = document.querySelector('#room-description');
  const descriptionCount = document.querySelector('.description-count');
  const roomCodeInput = document.querySelector('#room-code');
  const roomTypeSelect = document.querySelector('#room-type-select');
  const nightlyRateInput = document.querySelector('#nightly-rate');
  const editingStatusInput = document.querySelector('#room-status');
  const formHeading = document.querySelector('#room-form-heading');
  const formDescription = document.querySelector('#room-form-description');
  const formTitle = document.querySelector('#room-form-title');
  const formKicker = document.querySelector('#room-view-kicker');
  const submitLabel = document.querySelector('#room-submit-label');
  let editingRoomId = null;

  const setRoomView = (viewName) => {
    Object.entries(roomViews).forEach(([name, view]) => view.classList.toggle('hidden-view', name !== viewName));
    navigationButtons.forEach((button) => button.classList.toggle('active', button.dataset.roomView === viewName));
    if (viewName === 'add') document.querySelector('#room-code').focus();
  };

  navigationButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.roomView === 'add') {
        clearRoomForm();
        roomMessage.textContent = '';
      }
      setRoomView(button.dataset.roomView);
    });
  });

  const clearRoomForm = () => {
    roomForm.reset();
    editingRoomId = null;
    formHeading.textContent = 'Thêm phòng';
    formDescription.textContent = 'Tạo phòng mới, nhập đầy đủ thông tin để đưa vào hệ thống.';
    formTitle.textContent = 'Thêm phòng vào hệ thống';
    formKicker.textContent = 'THÊM MỚI';
    submitLabel.textContent = 'Thêm phòng';
    imagePreview.classList.add('hidden');
    imagePreview.innerHTML = '';
    descriptionCount.textContent = '0/240 ký tự';
    roomError.textContent = '';
  };

  openRoomForm = (room) => {
    editingRoomId = String(room.id);
    roomCodeInput.value = room.roomCode || '';
    descriptionInput.value = room.shortDescription || '';
    roomTypeSelect.value = room.roomType || '';
    nightlyRateInput.value = room.nightlyRate ?? '';
    editingStatusInput.value = room.status || 'Phòng trống';
    descriptionCount.textContent = `${descriptionInput.value.length}/240 ký tự`;
    formHeading.textContent = `Cập nhật phòng ${room.roomCode || ''}`;
    formDescription.textContent = 'Chỉnh sửa thông tin phòng và lưu thay đổi.';
    formTitle.textContent = 'Cập nhật thông tin phòng';
    formKicker.textContent = 'CẬP NHẬT';
    submitLabel.textContent = 'Lưu thay đổi';
    roomError.textContent = '';
    roomMessage.textContent = '';
    const imagePath = room.imagePath || '';
    if (imagePath) {
      imagePreview.innerHTML = `<img src="${escapeHtml(imagePath)}" alt="Ảnh hiện tại của phòng"><span>Ảnh hiện tại · chọn ảnh mới để thay thế</span>`;
      imagePreview.classList.remove('hidden');
    } else {
      imagePreview.classList.add('hidden');
      imagePreview.innerHTML = '';
    }
    setRoomView('add');
  };

  cancelButton.addEventListener('click', () => {
    clearRoomForm();
    roomMessage.textContent = '';
    setRoomView('list');
  });

  descriptionInput.addEventListener('input', () => {
    descriptionCount.textContent = `${descriptionInput.value.length}/240 ký tự`;
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) {
      imagePreview.classList.add('hidden');
      imagePreview.innerHTML = '';
      return;
    }
    imagePreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Ảnh xem trước"><span>${escapeHtml(file.name)}</span>`;
    imagePreview.classList.remove('hidden');
  });

  roomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    roomMessage.textContent = '';
    roomError.textContent = '';

    if (!roomForm.checkValidity()) {
      roomForm.reportValidity();
      return;
    }
    const imageFile = imageInput.files[0];
    if (imageFile && imageFile.size > 5 * 1024 * 1024) {
      roomError.textContent = 'Ảnh phòng không được vượt quá 5MB.';
      return;
    }

    try {
      const response = await fetch(editingRoomId
        ? `/api/rooms/${encodeURIComponent(editingRoomId)}`
        : '/api/rooms', {
        method: editingRoomId ? 'PUT' : 'POST',
        body: new FormData(roomForm)
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Không thể thêm phòng.');
      }

      roomMessage.textContent = result.message;
      clearRoomForm();
      await loadRoomList();
      const listMessage = document.querySelector('#room-list-message');
      listMessage.textContent = result.message;
      setRoomView('list');
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
    document.querySelector('#top-name').textContent = user.fullName;
    document.querySelector('#avatar').textContent = user.fullName.charAt(0).toUpperCase();
    await Promise.all([loadRoomList(), loadRoomTypes()]);
  } catch {
    window.location.href = '/login.html';
  }
}

loadSession();
