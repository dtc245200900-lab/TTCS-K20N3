const form = document.querySelector('#login-form');
let roomTypesCache = [];
let roomCache = [];
let openRoomForm;
let openRentRoom;
let roomFeedbackTimeout;

function showRoomFeedback(message, type = 'success') {
  const feedback = document.querySelector('#room-feedback');
  const icon = feedback?.querySelector('.room-feedback-icon');
  const text = feedback?.querySelector('#room-feedback-text');
  if (!feedback || !icon || !text) return;

  clearTimeout(roomFeedbackTimeout);
  feedback.hidden = !message;
  feedback.classList.toggle('is-error', type === 'error');
  feedback.setAttribute('role', type === 'error' ? 'alert' : 'status');
  icon.textContent = type === 'error' ? '!' : '✓';
  text.textContent = message;
  if (message && type === 'success') {
    roomFeedbackTimeout = window.setTimeout(() => {
      feedback.hidden = true;
      text.textContent = '';
    }, 4000);
  }
}

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
  if (['occupied', 'rented', 'da-thue', 'da-cho-thue', 'dang-thue', 'dang-cho-thue', 'da-co-nguoi-thue'].includes(normalized)) {
    return { className: 'occupied', label: 'ĐÃ CHO THUÊ' };
  }
  return { className: 'maintenance', label: String(status || 'Chưa cập nhật').toLocaleUpperCase('vi') };
}

function formatTimeOnly(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roomRentalField(room, ...keys) {
  const currentRental = room.currentRental || room.current_rental || {};
  for (const source of [currentRental, room]) {
    for (const key of keys) {
      const value = source[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return null;
}

function formatRoomTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roomRentalPrice(room, now = Date.now()) {
  const nightlyRate = Number(room.nightlyRate ?? room.nightly_rate);
  const checkInValue = roomRentalField(room, 'checkInAt', 'checkInTime', 'check_in_time', 'checked_in_at');
  const checkOutValue = roomRentalField(room, 'checkOutAt', 'checkOutTime', 'check_out_time', 'checkout_time', 'checked_out_at');
  if (!checkInValue || !Number.isFinite(Number(new Date(checkInValue).getTime()))) {
    return null;
  }

  const checkIn = new Date(checkInValue);
  const hasCheckOut = checkOutValue !== null;
  const calculationEndTime = hasCheckOut ? new Date(checkOutValue) : new Date(now);

  if (!Number.isFinite(nightlyRate) || nightlyRate <= 0 || !Number.isFinite(checkIn.getTime()) || !Number.isFinite(calculationEndTime.getTime()) || calculationEndTime.getTime() < checkIn.getTime()) {
    return null;
  }

  const elapsedMinutes = Math.max(0, Math.floor((calculationEndTime.getTime() - checkIn.getTime()) / 60000));
  if (elapsedMinutes <= 0) {
    return 0;
  }

  if (hasCheckOut) {
    const savedTotal = Number(roomRentalField(
      room,
      'rentalTotal',
      'currentRentalTotal',
      'current_rental_total',
      'totalAmount',
      'total_amount',
      'rental_total',
    ));
    if (Number.isFinite(savedTotal) && savedTotal > 0) {
      return savedTotal;
    }
  }

  return nightlyRate * elapsedMinutes / 1440;
}

function updateLiveRoomPrices() {
  const roomGrid = document.querySelector('#room-grid');
  const now = Date.now();
  for (const room of roomCache) {
    if (roomStatusInfo(room.status).className !== 'occupied') continue;
    const price = roomRentalPrice(room, now);
    if (price === null) continue;
    const formattedPrice = `${Number(price).toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}đ`;
    const cardPrice = roomGrid?.querySelector(`[data-room-total-id="${CSS.escape(String(room.id))}"]`);
    const overviewPrice = document.querySelector(`#overview-room-map [data-map-total-id="${CSS.escape(String(room.id))}"]`);
    if (cardPrice) {
      cardPrice.textContent = formattedPrice;
    }
    if (overviewPrice) {
      overviewPrice.textContent = formattedPrice;
    }
  }
}

if (form) {
  const errorMessage = document.querySelector('#error-message');
  const successMessage = document.querySelector('#success-message');
  const submitButton = document.querySelector('#submit-button');
  const buttonLabel = submitButton?.querySelector('.button-label');
  const passwordToggle = document.querySelector('#password-toggle');
  const passwordInput = document.querySelector('#password');
  const loginTab = document.querySelector('#login-tab');
  const registerTab = document.querySelector('#register-tab');
  const fullNameGroup = document.querySelector('#full-name-group');
  const fullNameInput = document.querySelector('#full-name');
  const confirmPasswordGroup = document.querySelector('#confirm-password-group');
  const confirmPasswordInput = document.querySelector('#confirm-password');
  const registerTerms = document.querySelector('#register-terms');
  const registerTermsRow = registerTerms?.closest('.register-terms');
  const rememberRow = document.querySelector('.field-row');
  const rememberInput = document.querySelector('#remember-me');
  const authTitle = document.querySelector('#auth-title');
  const authSubtitle = document.querySelector('#auth-subtitle');
  let currentMode = 'login';

  const setMode = (mode, clearMessages = true) => {
    currentMode = mode;
    const isRegister = mode === 'register';

    if (fullNameGroup) fullNameGroup.classList.toggle('hidden', !isRegister);
    if (confirmPasswordGroup) confirmPasswordGroup.classList.toggle('hidden', !isRegister);
    if (registerTermsRow) registerTermsRow.hidden = !isRegister;
    if (registerTerms) registerTerms.required = isRegister;
    if (rememberRow) rememberRow.classList.toggle('hidden', isRegister);

    if (fullNameInput) fullNameInput.required = isRegister;
    if (confirmPasswordInput) confirmPasswordInput.required = isRegister;
    if (authTitle) authTitle.textContent = isRegister ? 'Tạo tài khoản' : 'Đăng nhập';
    if (authSubtitle) authSubtitle.textContent = isRegister
      ? 'Tạo tài khoản mới để quản lý khách sạn'
      : 'Chào mừng bạn quay trở lại!\nVui lòng đăng nhập để tiếp tục.';
    if (buttonLabel) buttonLabel.textContent = isRegister ? 'Đăng ký' : 'Đăng nhập';

    if (loginTab) {
      loginTab.classList.toggle('active', !isRegister);
      loginTab.setAttribute('aria-selected', String(!isRegister));
    }
    if (registerTab) {
      registerTab.classList.toggle('active', isRegister);
      registerTab.setAttribute('aria-selected', String(isRegister));
    }

    if (passwordInput) passwordInput.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
    if (clearMessages) {
      if (errorMessage) errorMessage.textContent = '';
      if (successMessage) successMessage.textContent = '';
    }
  };

  const navigateToMode = (mode) => {
    if (mode === 'register') {
      window.location.assign('/register.html');
      return;
    }
    window.location.assign('/login.html');
  };

  const showSupport = () => {
    if (errorMessage) errorMessage.textContent = '';
    if (successMessage) successMessage.textContent = 'Vui lòng liên hệ quản trị viên khách sạn để được hỗ trợ tài khoản và đặt lại mật khẩu.';
  };

  const forgotPasswordBtn = document.querySelector('#forgot-password');
  if (forgotPasswordBtn) forgotPasswordBtn.addEventListener('click', showSupport);

  const contactAdminBtn = document.querySelector('#contact-admin');
  if (contactAdminBtn) {
    contactAdminBtn.addEventListener('click', () => {
      navigateToMode(window.location.pathname.endsWith('/register.html') ? 'login' : 'register');
    });
  }

  document.querySelectorAll('.social-button').forEach((button) => {
    const provider = ['google', 'microsoft', 'github'].find(name => button.classList.contains(name));
    if (!provider) return;
    button.addEventListener('click', () => {
      const flow = window.location.pathname.endsWith('/register.html') ? 'register' : 'login';
      window.location.assign(`/auth/${provider}?flow=${flow}`);
    });
  });

  if (loginTab) loginTab.addEventListener('click', () => navigateToMode('login'));
  if (registerTab) registerTab.addEventListener('click', () => navigateToMode('register'));

  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      passwordToggle.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
      passwordToggle.setAttribute('aria-pressed', String(!showing));
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled || !form.reportValidity()) return;
    errorMessage.textContent = '';
    successMessage.textContent = '';
    submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');

    try {
      const isRegister = currentMode === 'register';
      const payload = isRegister
        ? {
            fullName: fullNameInput.value.trim(),
            email: document.querySelector('#email').value.trim(),
            password: passwordInput.value,
            confirmPassword: confirmPasswordInput.value
          }
        : {
            email: document.querySelector('#email').value.trim(),
            password: passwordInput.value,
            rememberMe: rememberInput.checked
          };

      const response = await fetch(isRegister ? '/api/register' : '/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (!response.ok) {
        errorMessage.textContent = result.message || 'Không thể xử lý yêu cầu.';
        return;
      }

      if (isRegister) {
        form.reset();
        setMode('login', false);
        successMessage.textContent = result.message || 'Tạo tài khoản thành công.';
        document.querySelector('#email').value = payload.email;
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

  const isRegisterPage = window.location.pathname.endsWith('/register.html');
  setMode(isRegisterPage ? 'register' : 'login');

  const oauthMessages = {
    provider_not_configured: 'Đăng nhập bằng nhà cung cấp này chưa được cấu hình.',
    email_not_verified: 'Nhà cung cấp chưa xác nhận email của bạn.',
    email_exists: 'Email này đã có tài khoản. Hãy đăng nhập bằng email và mật khẩu.',
    oauth_failed: 'Không thể xác thực với nhà cung cấp. Vui lòng thử lại.'
  };
  const oauthError = new URLSearchParams(window.location.search).get('oauth_error');
  if (oauthError && errorMessage) {
    errorMessage.textContent = oauthMessages[oauthError] || oauthMessages.oauth_failed;
  }
}

const logoutButton = document.querySelector('#logout-button');
if (logoutButton) {
  logoutButton.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const errorMessage = document.querySelector('#logout-error');
    const accountMenu = document.querySelector('#account-menu');
    button.disabled = true;
    if (errorMessage) errorMessage.textContent = '';
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể đăng xuất.');
      window.location.href = '/login.html';
    } catch (error) {
      if (errorMessage) errorMessage.textContent = error.message || 'Không thể kết nối đến máy chủ.';
      button.disabled = false;
      if (accountMenu) accountMenu.hidden = false;
    }
  });
}

const accountToggle = document.querySelector('#account-toggle');
const accountMenu = document.querySelector('#account-menu');
if (accountToggle && accountMenu) {
  const closeAccountMenu = () => {
    accountMenu.hidden = true;
    accountToggle.setAttribute('aria-expanded', 'false');
  };
  accountToggle.addEventListener('click', () => {
    accountMenu.hidden = !accountMenu.hidden;
    accountToggle.setAttribute('aria-expanded', String(!accountMenu.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.sidebar-account')) closeAccountMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAccountMenu();
  });
  document.querySelector('#profile-menu-item')?.addEventListener('click', closeAccountMenu);
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

async function returnRoom(roomId, button) {
  const room = roomCache.find(item => String(item.id) === String(roomId));
  if (!room || roomStatusInfo(room.status).className !== 'occupied') {
    showRoomFeedback('Phòng hiện không được cho thuê.', 'error');
    return;
  }

  const dialog = document.querySelector('#checkout-room-dialog');
  if (!dialog) return;
  const roomCode = room.roomCode || room.room_code || room.roomNumber || '';
  const image = dialog.querySelector('#checkout-room-image');
  const checkIn = roomRentalField(room, 'checkInAt', 'checkInTime', 'check_in_time', 'checked_in_at');
  const checkOut = roomRentalField(room, 'checkOutAt', 'checkOutTime', 'check_out_time', 'checkout_time', 'checked_out_at');
  const formatDateTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  };
  image.src = room.imagePath || room.image_path || '/assets/room-placeholder.svg';
  image.alt = `Ảnh phòng ${roomCode}`;
  image.onerror = () => {
    image.onerror = null;
    image.src = '/assets/room-placeholder.svg';
  };
  dialog.querySelector('#checkout-room-code').textContent = roomCode;
  dialog.querySelector('#checkout-room-type').textContent = roomTypeLabel(room.roomType || room.room_type || '');
  dialog.querySelector('#checkout-room-check-in').textContent = formatDateTime(checkIn);
  dialog.querySelector('#checkout-room-check-out').textContent = formatDateTime(checkOut);
  const total = roomRentalPrice(room);
  dialog.querySelector('#checkout-room-total').textContent = total === null
    ? '—'
    : `${Number(total).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`;
  dialog.querySelector('#checkout-room-error').textContent = '';
  dialog.querySelector('[data-checkout-submit]').disabled = false;
  dialog.querySelectorAll('[data-checkout-step]').forEach(step => {
    step.hidden = step.dataset.checkoutStep !== 'confirm';
  });
  dialog.classList.remove('is-success');
  dialog.dataset.step = 'confirm';
  dialog.dataset.roomId = roomId;
  showRoomFeedback('');
  dialog.showModal();
}

const checkoutRoomDialog = document.querySelector('#checkout-room-dialog');
if (checkoutRoomDialog) {
  const checkoutSubmit = checkoutRoomDialog.querySelector('[data-checkout-submit]');
  const setCheckoutStep = stepName => {
    checkoutRoomDialog.classList.toggle('is-success', stepName === 'success');
    checkoutRoomDialog.querySelectorAll('[data-checkout-step]').forEach(step => {
      step.hidden = step.dataset.checkoutStep !== stepName;
    });
  };

  checkoutRoomDialog.querySelectorAll('[data-close-checkout]').forEach(button => {
    button.addEventListener('click', () => checkoutRoomDialog.close());
  });

  checkoutRoomDialog.addEventListener('cancel', event => {
    if (checkoutRoomDialog.dataset.step === 'loading') event.preventDefault();
  });

  checkoutRoomDialog.querySelector('[data-checkout-submit]').addEventListener('click', async () => {
    const roomId = checkoutRoomDialog.dataset.roomId;
    const room = roomCache.find(item => String(item.id) === String(roomId));
    if (!room || roomStatusInfo(room.status).className !== 'occupied') {
      checkoutRoomDialog.querySelector('#checkout-room-error').textContent = 'Phòng hiện không được cho thuê.';
      return;
    }

    checkoutRoomDialog.dataset.step = 'loading';
    checkoutRoomDialog.querySelector('#checkout-room-error').textContent = '';
    checkoutSubmit.disabled = true;
    checkoutRoomDialog.querySelectorAll('[data-close-checkout]').forEach(button => { button.disabled = true; });
    setCheckoutStep('loading');
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'available' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể trả phòng.');
    if (!result.room) throw new Error('Máy chủ không trả về thông tin phòng đã cập nhật.');

    roomCache = roomCache.map(item => String(item.id) === String(result.room.id) ? result.room : item);
    document.dispatchEvent(new Event('rooms-updated'));
    renderRoomList();
    checkoutRoomDialog.querySelector('#checkout-success-message').textContent = `Phòng ${room.roomCode || room.room_code || room.roomNumber || ''} đã được cập nhật trạng thái thành Phòng trống.`;
    checkoutRoomDialog.dataset.step = 'success';
    setCheckoutStep('success');
  } catch (error) {
      checkoutRoomDialog.dataset.step = 'confirm';
      checkoutRoomDialog.querySelector('#checkout-room-error').textContent = error.message || 'Không thể trả phòng.';
      setCheckoutStep('confirm');
    } finally {
      checkoutSubmit.disabled = false;
      checkoutRoomDialog.querySelectorAll('[data-close-checkout]').forEach(button => { button.disabled = false; });
    }
  });

  checkoutRoomDialog.querySelector('[data-checkout-view-list]').addEventListener('click', () => {
    checkoutRoomDialog.close();
    document.querySelector('.room-navigation [data-room-view="list"]')?.click();
  });
}

function renderRoomList() {
  renderRoomGrid('#room-grid');
  renderRoomGrid('#checkout-room-grid', true);
}

function renderRoomGrid(gridSelector, occupiedOnly = false) {
  const roomGrid = document.querySelector(gridSelector);
  if (!roomGrid) return;
  const search = document.querySelector('#rooms-search');
  const typeFilter = document.querySelector('#rooms-type-filter');
  const statusFilter = document.querySelector('#rooms-status-filter');
  const bookingViewActive = document.querySelector('.room-navigation [data-room-view="booking"]')?.classList.contains('active');
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
  document.querySelector('#checkout-nav-count').textContent = occupied;
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

  const query = occupiedOnly ? '' : normalized(search?.value.trim() || '');
  const rooms = roomCache.filter(room => {
    const roomCode = room.roomCode || room.room_code || room.roomNumber || '';
    const roomType = room.roomType || room.room_type || '';
    const description = room.shortDescription ?? room.short_description ?? '';
    const matchesQuery = normalized(`${roomCode} ${roomType} ${description}`).includes(query);
    const status = roomStatusInfo(room.status).className;
    const matchesType = occupiedOnly || !typeFilter?.value || roomType === typeFilter.value;
    const matchesStatus = occupiedOnly ? status === 'occupied' : !statusFilter?.value || status === statusFilter.value;
    return matchesQuery && matchesType && matchesStatus;
  });
  const count = document.querySelector(occupiedOnly ? '#checkout-room-count' : '#room-count');
  if (count) count.textContent = occupiedOnly ? `${rooms.length} phòng đang có khách` : `${rooms.length} / ${roomCache.length} phòng`;
  if (!rooms.length) {
    roomGrid.innerHTML = `<div class="room-empty">${occupiedOnly ? 'Hiện không có phòng nào cần trả.' : roomCache.length ? 'Không tìm thấy phòng phù hợp.' : 'Chưa có phòng nào.'}</div>`;
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
        ? formatTimeOnly(roomRentalField(room, 'checkInAt', 'checkInTime', 'check_in_time', 'checked_in_at'))
        : '--:--';
      const checkOut = status.className === 'occupied'
        ? formatTimeOnly(roomRentalField(room, 'checkOutAt', 'checkOutTime', 'check_out_time', 'checkout_time', 'checked_out_at'))
        : '--:--';
      const currentRentalPrice = status.className === 'occupied' ? roomRentalPrice(room) : null;
      const priceLabel = status.className === 'occupied'
        ? currentRentalPrice === null ? '—' : `${Number(currentRentalPrice).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`
        : Number.isFinite(nightlyRate) && nightlyRate > 0
          ? `${nightlyRate.toLocaleString('vi-VN')}đ / đêm`
          : '';
      const statusAction = occupiedOnly || bookingViewActive
        ? status.className === 'occupied'
          ? { nextStatus: 'available', label: 'Trả phòng' }
          : status.className === 'available'
            ? { nextStatus: 'occupied', label: 'Đặt phòng' }
            : null
        : null;
      const readableStatus = status.className === 'occupied' ? 'Đang cho thuê' : status.className === 'available' ? 'Phòng trống' : status.label;

      return `
        <article class="room-card ${status.className}">
          <div class="room-card-media">
            <img class="room-card-image" src="${escapeHtml(imagePath)}" alt="Ảnh phòng ${escapeHtml(roomCode)}" onerror="this.onerror=null;this.src='/assets/room-placeholder.svg'">
            <button type="button" class="room-favorite" data-favorite-room="${escapeHtml(room.id)}" aria-label="Đánh dấu phòng ${escapeHtml(roomCode)} yêu thích" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg></button>
          </div>
          <div class="room-card-content">
            <span class="room-status ${status.className}"><i></i>${escapeHtml(readableStatus)}</span>
            <div class="room-card-heading"><div><h3 class="room-number">${escapeHtml(roomCode)}</h3><p class="room-type">${escapeHtml(roomTypeLabel(roomType))}</p></div><p class="room-price"${status.className === 'occupied' ? ` data-room-total-id="${escapeHtml(room.id)}" aria-label="Tổng tiền hiện tại phải trả"` : ''}>${escapeHtml(priceLabel)}</p></div>
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

const rentRoomDialog = document.querySelector('#rent-room-dialog');
const rentRoomForm = document.querySelector('#rent-room-form');
if (rentRoomDialog && rentRoomForm) {
  const checkInInput = document.querySelector('#rent-check-in');
  const checkOutInput = document.querySelector('#rent-check-out');
  const rentalError = document.querySelector('#rent-room-error');
  const rentalDuration = document.querySelector('#rent-duration');
  const rentalTotal = document.querySelector('#rent-total');
  const rentalRoomRate = document.querySelector('#rent-room-rate');
  let selectedRentalRoom = null;
  let selectedCheckIn = null;

  function localDateTimeValue(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatRentalCurrency(value) {
    return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`;
  }

  function formatDisplayDateTime(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function calculateRental() {
    const checkIn = selectedCheckIn;
    const checkOut = new Date(checkOutInput.value);
    const nightlyRate = Number(selectedRentalRoom?.nightlyRate ?? selectedRentalRoom?.nightly_rate);
    let message = '';

    if (!selectedRentalRoom?.id) message = 'Không tìm thấy phòng cần cho thuê.';
    else if (!(checkIn instanceof Date) || !Number.isFinite(checkIn.getTime())) message = 'Giờ vào không hợp lệ.';
    else if (checkIn.getTime() > Date.now()) message = 'Giờ vào không được sau thời gian hiện tại.';
    else if (!checkOutInput.value) message = 'Vui lòng chọn thời gian trả phòng.';
    else if (!Number.isFinite(checkOut.getTime())) message = 'Vui lòng chọn thời gian trả phòng hợp lệ.';
    else if (checkOut.getTime() <= checkIn.getTime()) message = 'Thời gian trả phòng phải sau thời gian vào.';
    else if (!Number.isFinite(nightlyRate) || nightlyRate <= 0) message = 'Giá phòng không hợp lệ.';

    if (message) {
      rentalDuration.textContent = '—';
      rentalTotal.textContent = '—';
      rentalTotal.removeAttribute('data-exact-total');
      return { valid: false, message };
    }

    const durationMinutes = (checkOut.getTime() - checkIn.getTime()) / 60000;
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      rentalDuration.textContent = '—';
      rentalTotal.textContent = '—';
      rentalTotal.removeAttribute('data-exact-total');
      return { valid: false, message: 'Thời gian thuê phải lớn hơn 0 phút.' };
    }

    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    rentalDuration.textContent = `${hours ? `${hours} giờ` : ''}${hours && minutes ? ' ' : ''}${minutes ? `${minutes} phút` : ''}` || '0 phút';
    const total = nightlyRate * durationMinutes / 1440;
    rentalRoomRate.textContent = `${formatRentalCurrency(nightlyRate)}/ngày`;
    const roundedTotal = Math.floor(total * 100 + 0.5) / 100;
    rentalTotal.textContent = `≈ ${formatRentalCurrency(roundedTotal)}`;
    rentalTotal.dataset.exactTotal = roundedTotal.toFixed(2);
    return { valid: true, checkIn, checkOut, durationMinutes, total: roundedTotal };
  }

  openRentRoom = (room) => {
    if (!room || roomStatusInfo(room.status).className !== 'available') {
      showRoomFeedback('Không thể cho thuê phòng đang được sử dụng.', 'error');
      return;
    }
    selectedRentalRoom = room;
    rentRoomForm.reset();
    rentalError.textContent = '';
    showRoomFeedback('');
    const now = new Date();
    now.setSeconds(0, 0);
    selectedCheckIn = now;
    checkInInput.value = formatDisplayDateTime(now);
    checkOutInput.min = localDateTimeValue(now);
    checkOutInput.value = localDateTimeValue(new Date(now.getTime() + 3600000));
    const image = document.querySelector('#rent-room-image');
    const imagePath = room.imagePath || room.image_path || '';
    image.classList.toggle('hidden', !imagePath);
    image.src = imagePath;
    image.alt = `Ảnh phòng ${room.roomCode || room.room_code || ''}`;
    image.onerror = () => {
      image.onerror = null;
      image.src = '/assets/room-placeholder.svg';
    };
    document.querySelector('#rent-room-code').textContent = room.roomCode || room.room_code || room.roomNumber || '';
    document.querySelector('#rent-room-type').textContent = roomTypeLabel(room.roomType || room.room_type || '');
    document.querySelector('#rent-room-description').textContent = room.shortDescription || room.short_description || 'Không có mô tả.';
    document.querySelector('#rent-room-status').textContent = `Trạng thái hiện tại: ${room.status || 'Phòng trống'}`;
    rentalRoomRate.textContent = `${formatRentalCurrency(Number(room.nightlyRate ?? room.nightly_rate))}/ngày`;
    calculateRental();
    rentRoomDialog.showModal();
  };

  checkOutInput.addEventListener('input', () => {
    rentalError.textContent = '';
    showRoomFeedback('');
    calculateRental();
  });

  rentRoomForm.querySelectorAll('[data-close-rent]').forEach(button => {
    button.addEventListener('click', () => {
      rentRoomDialog.close();
      rentalError.textContent = '';
      showRoomFeedback('');
    });
  });

  rentRoomForm.addEventListener('submit', async event => {
    event.preventDefault();
    rentalError.textContent = '';
    const estimate = calculateRental();
    if (!estimate.valid) {
      rentalError.textContent = estimate.message;
      showRoomFeedback(estimate.message, 'error');
      return;
    }
    if (roomStatusInfo(selectedRentalRoom.status).className !== 'available') {
      rentalError.textContent = 'Không thể cho thuê phòng đang được sử dụng.';
      showRoomFeedback(rentalError.textContent, 'error');
      return;
    }

    const saveButton = rentRoomForm.querySelector('[type="submit"]');
    saveButton.disabled = true;
    showRoomFeedback('');
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selectedRentalRoom.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Đã thuê',
          checkInAt: localDateTimeValue(estimate.checkIn),
          checkOutAt: localDateTimeValue(estimate.checkOut),
          durationMinutes: estimate.durationMinutes,
          rentalTotal: estimate.total.toFixed(2)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể cho thuê phòng.');

      if (!result.room) throw new Error('Máy chủ không trả về thông tin phòng đã cập nhật.');
      roomCache = roomCache.map(room => String(room.id) === String(result.room.id) ? result.room : room);
      document.dispatchEvent(new Event('rooms-updated'));
      renderRoomList();
      rentRoomDialog.close();
      showRoomFeedback('Đặt phòng thành công!');
    } catch (error) {
      rentalError.textContent = error.message || 'Không thể cho thuê phòng.';
      showRoomFeedback(rentalError.textContent, 'error');
    } finally {
      saveButton.disabled = false;
    }
  });
}

const overviewRoomMap = document.querySelector('#overview-room-map');
if (overviewRoomMap) {
  overviewRoomMap.addEventListener('click', async event => {
    const checkoutButton = event.target.closest('[data-checkout-room]');
    if (!checkoutButton) return;
    event.stopPropagation();
    await returnRoom(checkoutButton.dataset.checkoutRoom, checkoutButton);
  });
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
                <th>Mô tả</th>
                <th>Số lượng phòng</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${roomTypesCache.map((roomType, index) => {
                const relatedRooms = roomCache.filter((room) => (room.roomType || room.room_type || '') === roomType.name);
                const count = relatedRooms.length;
                const description = roomType.description || '—';
                return `
                  <tr data-room-type-name="${escapeHtml(roomType.name)}">
                    <td>${index + 1}</td>
                    <td>${escapeHtml(roomType.code)}</td>
                    <td><span class="room-type-pill">${escapeHtml(roomTypeLabel(roomType.name))}</span></td>
                    <td>${escapeHtml(description)}</td>
                    <td class="room-type-count">${count}</td>
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
    row.querySelector('.room-type-count').textContent = roomCache
      .filter((room) => (room.roomType || room.room_type || '') === roomType.name).length;
  });
});

const roomTypeForm = document.querySelector('#room-type-form');
if (roomTypeForm) {
  const toggleButton = document.querySelector('#toggle-room-type-form');
  const cancelButton = document.querySelector('#cancel-room-type-form');
  const codeInput = document.querySelector('#room-type-code');
  const nameInput = document.querySelector('#room-type-name');
  const descriptionInput = document.querySelector('#room-type-description');
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

  toggleButton.addEventListener('click', () => {
    resetRoomTypeForm();
    roomTypeForm.classList.remove('hidden-form');
    codeInput.value = roomTypesCache.length
      ? `LP${String(Math.max(...roomTypesCache.map((item) => Number(String(item.code).replace(/^LP/i, '')) || 0)) + 1).padStart(3, '0')}`
      : 'LP001';
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
    descriptionInput.value = roomType.description || '';
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
    const description = descriptionInput.value.trim();
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
        body: JSON.stringify({ name, description })
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

document.querySelectorAll('#room-grid, #checkout-room-grid').forEach(roomGrid => {
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
      if (statusButton.dataset.nextStatus === 'occupied') {
        const room = roomCache.find(item => String(item.id) === statusButton.dataset.roomId);
        openRentRoom?.(room);
        return;
      }
      await returnRoom(statusButton.dataset.roomId, statusButton);
      return;
    }

    const deleteButton = event.target.closest('.delete-room-button');
    if (!deleteButton) return;

    const roomId = deleteButton.dataset.roomId;
    const roomCode = deleteButton.closest('.room-card').querySelector('.room-number').textContent;
    const room = roomCache.find((item) => String(item.id) === roomId);
    if (room && roomStatusInfo(room.status).className === 'occupied') {
      showRoomFeedback('Không thể xóa phòng đang được thuê.', 'error');
      return;
    }
    showRoomFeedback('');
    if (!window.confirm(`Bạn có chắc chắn muốn xóa phòng ${roomCode}?`)) return;

    deleteButton.disabled = true;

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể xóa phòng.');

      await loadRoomList();
      showRoomFeedback('Xóa phòng thành công!');
    } catch (error) {
      showRoomFeedback(error.message || 'Không thể xóa phòng.', 'error');
      deleteButton.disabled = false;
    }
  });
});

document.querySelector('#rooms-search')?.addEventListener('input', renderRoomList);
document.querySelector('#rooms-type-filter')?.addEventListener('change', renderRoomList);
document.querySelector('#rooms-status-filter')?.addEventListener('change', renderRoomList);
window.setInterval(updateLiveRoomPrices, 60000);
document.querySelector('#room-type-search')?.addEventListener('input', (event) => {
  const term = (event.target.value || '').trim().toLowerCase();
  document.querySelectorAll('#room-type-list tbody tr').forEach((row) => {
    const text = (row.dataset.roomTypeName || row.textContent || '').toLowerCase();
    row.style.display = text.includes(term) ? '' : 'none';
  });
});
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
    checkout: document.querySelector('#room-checkout-view'),
    add: document.querySelector('#room-add-view'),
    types: document.querySelector('#room-types-view'),
    profile: document.querySelector('#profile-view')
  };
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
    const contentViewName = viewName === 'booking' ? 'list' : viewName;
    Object.entries(roomViews).forEach(([name, view]) => view.classList.toggle('hidden-view', name !== contentViewName));
    roomViews.list.classList.toggle('booking-view', viewName === 'booking');
    navigationButtons.forEach((button) => button.classList.toggle('active', button.dataset.roomView === viewName));
    document.querySelectorAll('.room-navigation [data-room-view]').forEach((button) => {
      if (button.dataset.roomView === viewName) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelector('#page-title').textContent = { overview: 'Tổng quan', list: 'Phòng', booking: 'Đặt phòng', checkout: 'Trả phòng', add: 'Thông tin phòng', types: 'Thể loại phòng', profile: 'Cập nhật thông tin cá nhân' }[viewName];
    document.querySelector('#room-view-title').textContent = viewName === 'booking' ? 'Đặt phòng' : 'Danh sách phòng';
    document.querySelector('#room-view-description').textContent = viewName === 'booking'
      ? 'Chọn phòng trống để tạo đặt phòng.'
      : 'Theo dõi trạng thái và thời gian sử dụng của các phòng.';
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
        showRoomFeedback('');
      }
      if (button.dataset.roomView === 'booking') {
        document.querySelector('#rooms-status-filter').value = 'available';
      }
      setRoomView(button.dataset.roomView);
      if (['booking', 'list'].includes(button.dataset.roomView)) renderRoomList();
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
    showRoomFeedback('');
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
    showRoomFeedback('');
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
    roomError.textContent = '';

    if (!roomForm.checkValidity()) {
      const invalidField = roomForm.querySelector(':invalid');
      const validationMessage = invalidField?.validationMessage || 'Vui lòng kiểm tra các thông tin bắt buộc.';
      roomForm.reportValidity();
      roomError.textContent = validationMessage;
      if (!editingRoomId) showRoomFeedback(validationMessage, 'error');
      return;
    }
    const imageFile = imageInput ? imageInput.files[0] : null;
    if (imageFile && imageFile.size > 5 * 1024 * 1024) {
      roomError.textContent = 'Ảnh phòng không được vượt quá 5MB.';
      if (!editingRoomId) showRoomFeedback(roomError.textContent, 'error');
      return;
    }

    const wasAddingRoom = !editingRoomId;
    showRoomFeedback('');
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

      clearRoomForm();
      await loadRoomList();
      const listMessage = document.querySelector('#room-list-message');
      if (wasAddingRoom) {
        listMessage.textContent = '';
        showRoomFeedback('Thêm phòng thành công!');
      } else {
        listMessage.textContent = result.message;
      }
      setRoomView('list');
    } catch (error) {
      roomError.textContent = error.message;
      if (wasAddingRoom) showRoomFeedback(error.message || 'Không thể thêm phòng.', 'error');
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
    updateProfileForm(user);
    await Promise.all([loadRoomList(), loadRoomTypes()]);
  } catch {
    window.location.href = '/login.html';
  }
}

const profileForm = document.querySelector('#profile-form');
if (profileForm) {
  const avatarInput = document.querySelector('#profile-avatar');
  const avatarPreview = document.querySelector('#profile-avatar-preview');
  const errorMessage = document.querySelector('#profile-error');
  const successMessage = document.querySelector('#profile-success');
  const saveButton = document.querySelector('#profile-save-button');

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    successMessage.textContent = '';
    if (!profileForm.checkValidity()) {
      profileForm.reportValidity();
      errorMessage.textContent = 'Vui lòng kiểm tra và điền đầy đủ các thông tin bắt buộc.';
      return;
    }
    const avatarFile = avatarInput.files[0];
    if (avatarFile && avatarFile.size > 5 * 1024 * 1024) {
      errorMessage.textContent = 'Ảnh đại diện không được vượt quá 5MB.';
      return;
    }

    saveButton.disabled = true;
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        body: new FormData(profileForm)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể cập nhật thông tin cá nhân.');
      updateProfileForm(result.user);
      avatarInput.value = '';
      successMessage.textContent = result.message || 'Cập nhật thông tin cá nhân thành công';
    } catch (error) {
      errorMessage.textContent = error.message || 'Không thể cập nhật thông tin cá nhân.';
    } finally {
      saveButton.disabled = false;
    }
  });

  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files[0];
    if (file) avatarPreview.src = URL.createObjectURL(file);
  });
}

function updateProfileForm(user) {
  if (!user) return;
  const topName = document.querySelector('#top-name');
  const fullName = document.querySelector('#profile-full-name');
  const dateOfBirth = document.querySelector('#profile-date-of-birth');
  const email = document.querySelector('#profile-email');
  const phone = document.querySelector('#profile-phone');
  const avatarPreview = document.querySelector('#profile-avatar-preview');
  if (topName) topName.textContent = user.fullName || '';
  if (fullName) fullName.value = user.fullName || '';
  if (dateOfBirth) dateOfBirth.value = user.dateOfBirth || '';
  if (email) email.value = user.email || '';
  if (phone) phone.value = user.phone || '';
  const initials = (user.fullName || 'H').trim().charAt(0).toLocaleUpperCase('vi');
  const topAvatar = document.querySelector('#avatar');
  if (topAvatar) {
    topAvatar.textContent = user.avatar ? '' : initials;
    topAvatar.style.backgroundImage = user.avatar ? `url("${user.avatar}")` : '';
    topAvatar.classList.toggle('has-avatar', Boolean(user.avatar));
  }
  if (avatarPreview && user.avatar) avatarPreview.src = user.avatar;
}

loadSession();
