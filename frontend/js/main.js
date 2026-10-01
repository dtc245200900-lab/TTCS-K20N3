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
  const submitButton = document.querySelector('#submit-button');
  const passwordToggle = document.querySelector('#password-toggle');
  const passwordInput = document.querySelector('#password');

  const showSupport = () => {
    errorMessage.textContent = '';
    successMessage.textContent = 'Vui lòng liên hệ quản trị viên khách sạn để được hỗ trợ tài khoản và đặt lại mật khẩu.';
  };
  document.querySelector('#forgot-password').addEventListener('click', showSupport);
  document.querySelector('#contact-admin').addEventListener('click', showSupport);

  passwordToggle.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    passwordToggle.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
    passwordToggle.setAttribute('aria-pressed', String(!showing));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled || !form.reportValidity()) return;
    errorMessage.textContent = '';
    successMessage.textContent = '';
    submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.querySelector('#email').value.trim(),
          password: passwordInput.value,
          rememberMe: document.querySelector('#remember-me').checked
        })
      });
      const result = await response.json();
      if (!response.ok) {
        errorMessage.textContent = result.message || 'Không thể xử lý yêu cầu.';
        return;
      }
      window.location.assign('/home');
    } catch {
      errorMessage.textContent = 'Không thể kết nối đến máy chủ.';
    } finally {
      submitButton.disabled = false;
      form.removeAttribute('aria-busy');
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

  try {
    const response = await fetch('/api/rooms');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách phòng.');

    roomCache = result.rooms || [];
    document.dispatchEvent(new Event('rooms-updated'));
    renderRoomList();
  } catch (error) {
    roomGrid.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    document.dispatchEvent(new CustomEvent('rooms-error', { detail: error.message }));
  }
}

function renderRoomList() {
  const roomGrid = document.querySelector('#room-grid');
  if (!roomGrid) return;
  const search = document.querySelector('#rooms-search');
  const typeFilter = document.querySelector('#rooms-type-filter');
  const statusFilter = document.querySelector('#rooms-status-filter');
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const roomTypeNames = [...new Set([
    ...roomTypesCache.map(type => type.name),
    ...roomCache.map(room => room.roomType || room.room_type || '')
  ].filter(Boolean))];
  if (typeFilter) {
    const selectedType = typeFilter.value;
    typeFilter.innerHTML = '<option value="">Tất cả loại phòng</option>' + roomTypeNames
      .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(roomTypeLabel(name))}</option>`).join('');
    typeFilter.value = selectedType;
  }

  const occupied = roomCache.filter(room => roomStatusInfo(room.status).className === 'occupied').length;
  const available = roomCache.filter(room => roomStatusInfo(room.status).className === 'available').length;
  const usedRoomTypes = new Set(roomCache.map(room => room.roomType || room.room_type || '').filter(Boolean));
  for (const [key, value] of Object.entries({
    total: roomCache.length,
    occupied,
    available,
    types: usedRoomTypes.size
  })) {
    const target = document.querySelector(`#list-stat-${key}`);
    if (target) target.textContent = value;
  }

  const query = normalized(search?.value.trim() || '');
  const rooms = roomCache.filter(room => {
    const roomCode = room.roomCode || room.room_code || room.roomNumber || '';
    const roomType = room.roomType || room.room_type || '';
    const description = room.shortDescription ?? room.short_description ?? '';
    const matchesQuery = normalized(`${roomCode} ${roomType} ${description}`).includes(query);
    const matchesType = !typeFilter?.value || roomType === typeFilter.value;
    const matchesStatus = !statusFilter?.value || roomStatusInfo(room.status).className === statusFilter.value;
    return matchesQuery && matchesType && matchesStatus;
  });
  const count = document.querySelector('#room-count');
  if (count) count.textContent = `${rooms.length} / ${roomCache.length} phòng`;
  if (!rooms.length) {
    roomGrid.innerHTML = `<div class="room-empty">${roomCache.length ? 'Không tìm thấy phòng phù hợp.' : 'Chưa có phòng nào.'}</div>`;
    return;
  }

  roomGrid.innerHTML = rooms.map((room) => {
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
      const readableStatus = status.className === 'occupied' ? 'Đang cho thuê' : status.className === 'available' ? 'Phòng trống' : status.label;

      return `
        <article class="room-card ${status.className}">
          <div class="room-card-media">
            <img class="room-card-image" src="${escapeHtml(imagePath)}" alt="Ảnh phòng ${escapeHtml(roomCode)}" onerror="this.onerror=null;this.src='/assets/room-placeholder.svg'">
            <span class="room-status ${status.className}"><i></i>${escapeHtml(readableStatus)}</span>
            <button type="button" class="room-favorite" data-favorite-room="${escapeHtml(room.id)}" aria-label="Đánh dấu phòng ${escapeHtml(roomCode)} yêu thích" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg></button>
          </div>
          <div class="room-card-content">
            <div class="room-card-heading"><div><h3 class="room-number">${escapeHtml(roomCode)}</h3><p class="room-type">${escapeHtml(roomTypeLabel(roomType))}</p></div><p class="room-price">${escapeHtml(priceLabel)}</p></div>
            <p class="room-description">${escapeHtml(shortDescription)}</p>
            <div class="room-time">
              <div class="room-time-item"><span>Giờ vào</span><strong>${escapeHtml(checkIn)}</strong></div>
              <div class="room-time-item"><span>Giờ ra</span><strong>${escapeHtml(checkOut)}</strong></div>
            </div>
            <div class="room-meta">
              <button type="button" class="edit-room-button" data-room-id="${escapeHtml(room.id)}" aria-label="Cập nhật phòng ${escapeHtml(roomCode)}"><span aria-hidden="true">ⓘ</span> Cập nhật</button>
              ${statusAction ? `<button type="button" class="room-status-toggle ${status.className}" data-room-id="${escapeHtml(room.id)}" data-next-status="${statusAction.nextStatus}">${statusAction.label}</button>` : ''}
              <button type="button" class="delete-room-button" data-room-id="${escapeHtml(room.id)}" aria-label="Xóa phòng ${escapeHtml(roomCode)}"><span aria-hidden="true">▤</span> Xóa</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
}

async function loadRoomTypes() {
  const roomTypeList = document.querySelector('#room-type-list');
  if (!roomTypeList) return;

  try {
    const response = await fetch('/api/room-types');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách thể loại phòng.');

    roomTypesCache = result.roomTypes || [];
    document.dispatchEvent(new Event('room-types-updated'));
    renderRoomList();
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
      ? `
        <div class="room-type-table-wrap">
          <table class="room-type-table">
            <thead>
              <tr>
                <th>STT</th>
                <th>Mã loại phòng</th>
                <th>Tên loại phòng</th>
                <th>Số lượng phòng</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${roomTypesCache.map((roomType, index) => {
                const count = roomCache.filter((room) => (room.roomType || room.room_type || '') === roomType.name).length;
                return `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(roomType.code)}</td>
                    <td>${escapeHtml(roomTypeLabel(roomType.name))}</td>
                    <td>${count}</td>
                    <td class="room-type-actions-cell">
                      <button type="button" class="edit-room-type-button" data-room-type-code="${escapeHtml(roomType.code)}">Cập nhật</button>
                      <button type="button" class="delete-room-type-button" data-room-type-code="${escapeHtml(roomType.code)}" aria-label="Xóa thể loại ${escapeHtml(roomTypeLabel(roomType.name))}">Xóa</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `
      : '<p class="muted">Chưa có thể loại phòng.</p>';
  } catch (error) {
    roomTypeList.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

document.addEventListener('rooms-updated', () => {
  document.querySelectorAll('#room-type-list tbody tr').forEach((row, index) => {
    const roomType = roomTypesCache[index];
    if (!roomType) return;
    row.cells[3].textContent = roomCache
      .filter((room) => (room.roomType || room.room_type || '') === roomType.name).length;
  });
});

const roomTypeForm = document.querySelector('#room-type-form');
if (roomTypeForm) {
  const toggleButton = document.querySelector('#toggle-room-type-form');
  const cancelButton = document.querySelector('#cancel-room-type-form');
  const codeInput = document.querySelector('#room-type-code');
  const nameInput = document.querySelector('#room-type-name');
  const quantityInput = document.querySelector('#room-type-quantity');
  const errorMessage = document.querySelector('#room-type-error');
  const successMessage = document.querySelector('#room-type-message');
  let editingCode = null;

  function resetRoomTypeForm() {
    editingCode = null;
    roomTypeForm.reset();
    roomTypeForm.classList.add('hidden-form');
    toggleButton.textContent = 'Thêm mới';
    roomTypeForm.querySelector('[type="submit"]').textContent = 'Lưu thể loại';
    errorMessage.textContent = '';
  }

  function updateRoomTypeQuantity() {
    const roomType = roomTypesCache.find((item) => item.code === editingCode);
    quantityInput.value = roomType
      ? roomCache.filter((room) => (room.roomType || room.room_type || '') === roomType.name).length
      : 0;
  }

  document.addEventListener('rooms-updated', () => {
    if (!roomTypeForm.classList.contains('hidden-form')) updateRoomTypeQuantity();
  });

  toggleButton.addEventListener('click', () => {
    resetRoomTypeForm();
    roomTypeForm.classList.remove('hidden-form');
    codeInput.value = roomTypesCache.length
      ? `LP${String(Math.max(...roomTypesCache.map((item) => Number(String(item.code).replace(/^LP/i, '')) || 0)) + 1).padStart(3, '0')}`
      : 'LP001';
    quantityInput.value = 0;
    errorMessage.textContent = '';
    successMessage.textContent = '';
    successMessage.classList.remove('error');
    nameInput.focus();
  });

  cancelButton.addEventListener('click', () => {
    resetRoomTypeForm();
    successMessage.textContent = '';
    successMessage.classList.remove('error');
  });

  document.querySelector('#room-type-list').addEventListener('click', (event) => {
    const deleteButton = event.target.closest('.delete-room-type-button');
    if (deleteButton) {
      const roomType = roomTypesCache.find((item) => item.code === deleteButton.dataset.roomTypeCode);
      if (!roomType || !window.confirm(`Xóa thể loại "${roomTypeLabel(roomType.name)}"? Thể loại đang được phòng sử dụng sẽ không thể xóa.`)) return;

      deleteButton.disabled = true;
      errorMessage.textContent = '';
      successMessage.textContent = '';
      successMessage.classList.remove('error');
      fetch(`/api/room-types/${encodeURIComponent(roomType.code)}`, { method: 'DELETE' })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Không thể xóa thể loại phòng.');
          if (editingCode === roomType.code) resetRoomTypeForm();
          successMessage.textContent = result.message;
          await loadRoomTypes();
        })
        .catch((error) => {
          successMessage.textContent = error.message;
          successMessage.classList.add('error');
          deleteButton.disabled = false;
        });
      return;
    }

    const button = event.target.closest('.edit-room-type-button');
    if (!button) return;
    const roomType = roomTypesCache.find((item) => item.code === button.dataset.roomTypeCode);
    if (!roomType) return;

    editingCode = roomType.code;
    codeInput.value = roomType.code;
    nameInput.value = roomType.name;
    updateRoomTypeQuantity();
    roomTypeForm.classList.remove('hidden-form');
    toggleButton.textContent = 'Đang cập nhật';
    roomTypeForm.querySelector('[type="submit"]').textContent = 'Lưu thay đổi';
    errorMessage.textContent = '';
    successMessage.textContent = '';
    successMessage.classList.remove('error');
    nameInput.focus();
  });

  roomTypeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    successMessage.textContent = '';
    successMessage.classList.remove('error');
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) {
      errorMessage.textContent = 'Tên thể loại không được để trống.';
      nameInput.focus();
      return;
    }
    try {
      const response = await fetch(editingCode
        ? `/api/room-types/${encodeURIComponent(editingCode)}`
        : '/api/room-types', {
        method: editingCode ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể lưu thể loại phòng.');

      resetRoomTypeForm();
      successMessage.textContent = `${result.message} (${result.roomType.code}: ${result.roomType.name})`;
      await loadRoomTypes();
    } catch (error) {
      errorMessage.textContent = error.message;
    }
  });
}

const roomGrid = document.querySelector('#room-grid');
if (roomGrid) {
  roomGrid.addEventListener('click', async (event) => {
    const favoriteButton = event.target.closest('.room-favorite');
    if (favoriteButton) {
      const isFavorite = favoriteButton.getAttribute('aria-pressed') === 'true';
      favoriteButton.setAttribute('aria-pressed', String(!isFavorite));
      favoriteButton.setAttribute('aria-label', `${isFavorite ? 'Đánh dấu' : 'Bỏ đánh dấu'} phòng yêu thích`);
      return;
    }

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

document.querySelector('#rooms-search')?.addEventListener('input', renderRoomList);
document.querySelector('#rooms-type-filter')?.addEventListener('change', renderRoomList);
document.querySelector('#rooms-status-filter')?.addEventListener('change', renderRoomList);
document.querySelectorAll('[data-room-layout]').forEach(button => {
  button.addEventListener('click', () => {
    const isList = button.dataset.roomLayout === 'list';
    roomGrid?.classList.toggle('list-layout', isList);
    document.querySelectorAll('[data-room-layout]').forEach(toggle => {
      const active = toggle === button;
      toggle.classList.toggle('active', active);
      toggle.setAttribute('aria-pressed', String(active));
    });
  });
});

const roomForm = document.querySelector('#room-form');
if (roomForm) {
  const navigationButtons = document.querySelectorAll('[data-room-view]');
  const roomViews = {
    overview: document.querySelector('#overview-view'),
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
    document.querySelectorAll('.room-navigation [data-room-view]').forEach((button) => {
      if (button.dataset.roomView === viewName) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelector('#page-title').textContent = { overview: 'Tổng quan', list: 'Phòng', add: 'Thông tin phòng', types: 'Thể loại phòng' }[viewName];
    if (viewName === 'add') document.querySelector('#room-code').focus();
  };

  const resetImagePreview = () => {
    if (!imagePreview) return;
    imagePreview.classList.add('hidden');
    imagePreview.innerHTML = '';
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
    resetImagePreview();
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
    if (imagePreview && imagePath) {
      imagePreview.innerHTML = `<img src="${escapeHtml(imagePath)}" alt="Ảnh hiện tại của phòng"><span>Ảnh hiện tại · chọn ảnh mới để thay thế</span>`;
      imagePreview.classList.remove('hidden');
    } else if (imagePreview) {
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

  if (imageInput) {
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!imagePreview) return;
      if (!file) {
        imagePreview.classList.add('hidden');
        imagePreview.innerHTML = '';
        return;
      }
      imagePreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Ảnh xem trước"><span>${escapeHtml(file.name)}</span>`;
      imagePreview.classList.remove('hidden');
    });
  }

  roomForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    roomMessage.textContent = '';
    roomError.textContent = '';

    if (!roomForm.checkValidity()) {
      roomForm.reportValidity();
      return;
    }
    const imageFile = imageInput ? imageInput.files[0] : null;
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
