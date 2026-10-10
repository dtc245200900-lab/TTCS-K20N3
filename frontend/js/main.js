const form = document.querySelector('#login-form');
let roomTypesCache = [];
let roomCache = [];
let bookingCache = [];
let customerCache = [];
let selectedBookingId = null;
let selectedCustomerId = null;
let editingCustomerId = null;
let openCustomerEditForm = null;
let customerPage = 1;
let customerPageSize = 8;
let bookingPage = 1;
const bookingPageSize = 8;
let openRoomForm;
let openRentRoom;
let roomFeedbackTimeout;
let dashboardCacheUserId = null;
let hasCachedRooms = false;
const notifiedCheckoutDeadlines = new Set();
let rentalStateRefreshRunning = false;

function dashboardCacheKey(name) {
  return dashboardCacheUserId ? `hotel-manager:${dashboardCacheUserId}:${name}` : null;
}

function readDashboardCache(name) {
  const key = dashboardCacheKey(name);
  if (!key) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    return Array.isArray(value) ? value : null;
  } catch (error) {
    console.warn(`Unable to read cached dashboard ${name}.`, error);
    return null;
  }
}

function saveDashboardCache(name, value) {
  const key = dashboardCacheKey(name);
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Unable to save cached dashboard ${name}.`, error);
  }
}

function restoreDashboardCache(userId) {
  dashboardCacheUserId = userId == null ? null : String(userId);
  if (!dashboardCacheUserId) return false;

  const cachedRooms = readDashboardCache('rooms');
  const cachedRoomTypes = readDashboardCache('room-types');
  if (cachedRooms === null && cachedRoomTypes === null) return false;

  if (cachedRooms !== null) {
    roomCache = cachedRooms;
    hasCachedRooms = true;
    document.dispatchEvent(new Event('rooms-updated'));
  }
  if (cachedRoomTypes !== null) {
    roomTypesCache = cachedRoomTypes;
    document.dispatchEvent(new Event('room-types-updated'));
  }
  if (cachedRooms !== null || cachedRoomTypes !== null) renderRoomList();
  return cachedRooms !== null;
}

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

function checkUpcomingCheckoutWarnings() {
  const now = Date.now();
  const warningWindow = 15 * 60 * 1000;
  const upcoming = [];
  const roomsById = new Map(roomCache.map(room => [String(room.id), room]));

  bookingCache.forEach(booking => {
    if (booking.status !== 'checked_in' || !booking.scheduledCheckOutAt) return;
    const deadline = new Date(booking.scheduledCheckOutAt).getTime();
    const key = `booking:${booking.id}:${booking.scheduledCheckOutAt}`;
    if (!Number.isFinite(deadline) || deadline <= now || deadline - now > warningWindow || notifiedCheckoutDeadlines.has(key)) return;
    notifiedCheckoutDeadlines.add(key);
    const room = roomsById.get(String(booking.roomId));
    upcoming.push(room?.roomCode || room?.room_code || booking.roomCode || `DP${booking.id}`);
  });

  roomCache.forEach(room => {
    if (roomStatusInfo(room.status).className !== 'occupied' || room.bookingId || room.booking_id) return;
    const deadlineValue = roomRentalField(room, 'checkOutAt', 'checkOutTime', 'checkout_time', 'checked_out_at');
    if (!deadlineValue) return;
    const deadline = new Date(deadlineValue).getTime();
    const key = `room:${room.id}:${deadlineValue}`;
    if (!Number.isFinite(deadline) || deadline <= now || deadline - now > warningWindow || notifiedCheckoutDeadlines.has(key)) return;
    notifiedCheckoutDeadlines.add(key);
    upcoming.push(room.roomCode || room.room_code || room.roomNumber || String(room.id));
  });

  if (upcoming.length) {
    showRoomFeedback(`Sắp hết giờ thuê (còn tối đa 15 phút): ${upcoming.join(', ')}. Phòng sẽ tự trả khi hết giờ.`);
  }
}

async function refreshRentalState() {
  if (rentalStateRefreshRunning || document.hidden) return;
  rentalStateRefreshRunning = true;
  const previousBookingStatuses = new Map(bookingCache.map(booking => [String(booking.id), booking.status]));
  const previousRoomStatuses = new Map(roomCache.map(room => [String(room.id), room.status]));
  try {
    await Promise.all([loadRoomList(), loadBookingList()]);
    const autoCheckedOut = bookingCache
      .filter(booking => booking.status === 'checked_out' && previousBookingStatuses.get(String(booking.id)) === 'checked_in')
      .map(booking => {
        const room = roomCache.find(item => String(item.id) === String(booking.roomId));
        return room?.roomCode || room?.room_code || booking.roomCode;
      })
      .filter(Boolean);
    const autoCheckedOutDirectly = roomCache
      .filter(room => roomStatusInfo(room.status).className === 'cleaning'
        && roomStatusInfo(previousRoomStatuses.get(String(room.id))).className === 'occupied'
        && !room.bookingId && !room.booking_id)
      .map(room => room.roomCode || room.room_code || room.roomNumber)
      .filter(Boolean);
    const checkedOutRooms = [...autoCheckedOut, ...autoCheckedOutDirectly];
    if (checkedOutRooms.length) {
      showRoomFeedback(`Đã tự động trả phòng ${checkedOutRooms.join(', ')} khi hết giờ. Phòng đang được dọn trong 30 phút.`);
    } else {
      checkUpcomingCheckoutWarnings();
    }
  } finally {
    rentalStateRefreshRunning = false;
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
  if (['cleaning', 'dang-don-phong', 'dang-don-phong', 'phong-dang-don'].includes(normalized)) {
    return { className: 'cleaning', label: 'ĐANG DỌN PHÒNG' };
  }
  if (['maintenance', 'bao-tri'].includes(normalized)) {
    return { className: 'maintenance', label: 'BẢO TRÌ' };
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

function formatBookingDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBookingDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function roomRentalPrice(room, now = Date.now()) {
  const hourlyRate = Number(room.hourlyRate ?? room.hourly_rate);
  const checkInValue = roomRentalField(room, 'checkInAt', 'checkInTime', 'check_in_time', 'checked_in_at');
  const checkOutValue = roomRentalField(room, 'checkOutAt', 'checkOutTime', 'check_out_time', 'checkout_time', 'checked_out_at');
  if (!checkInValue || !Number.isFinite(Number(new Date(checkInValue).getTime()))) {
    return null;
  }

  const checkIn = new Date(checkInValue);
  const hasCheckOut = checkOutValue !== null;
  const calculationEndTime = hasCheckOut ? new Date(checkOutValue) : new Date(now);

  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 || !Number.isFinite(checkIn.getTime()) || !Number.isFinite(calculationEndTime.getTime()) || calculationEndTime.getTime() < checkIn.getTime()) {
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

  return hourlyRate * Math.ceil(elapsedMinutes / 60);
}

function bookingRentalQuote(booking) {
  if (!booking?.scheduledCheckInAt || !booking?.scheduledCheckOutAt) return null;
  const hourlyRate = Number(booking.hourlyRate);
  const checkIn = new Date(booking.scheduledCheckInAt);
  const checkOut = new Date(booking.scheduledCheckOutAt);
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 || !Number.isFinite(checkIn.getTime())
    || !Number.isFinite(checkOut.getTime()) || checkOut <= checkIn) return null;
  return hourlyRate * Math.ceil((checkOut.getTime() - checkIn.getTime()) / 3600000);
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
  const usernameInput = document.querySelector('#username') || document.querySelector('#email');
  const phoneInput = document.querySelector('#phone');
  const phoneGroup = phoneInput?.closest('.field-group');
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
    if (phoneGroup) phoneGroup.classList.toggle('hidden', !isRegister);
    if (confirmPasswordGroup) confirmPasswordGroup.classList.toggle('hidden', !isRegister);
    if (registerTermsRow) registerTermsRow.hidden = !isRegister;
    if (registerTerms) registerTerms.required = isRegister;
    if (rememberRow) rememberRow.classList.toggle('hidden', isRegister);

    if (fullNameInput) fullNameInput.required = isRegister;
    if (phoneInput) phoneInput.required = isRegister;
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
    if (successMessage) successMessage.textContent = '';
    window.location.assign('/forgot-password.html');
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
      const usernameValue = (usernameInput?.value || '').trim();
      const phoneValue = (phoneInput?.value || '').trim();
      const payload = isRegister
        ? {
            fullName: fullNameInput.value.trim(),
            username: usernameValue,
            phone: phoneValue,
            password: passwordInput.value,
            confirmPassword: confirmPasswordInput.value
          }
        : {
            username: usernameValue || (document.querySelector('#email')?.value || '').trim(),
            password: passwordInput.value,
            rememberMe: rememberInput?.checked ?? false
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
        if (usernameInput) usernameInput.value = payload.username;
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
    github_not_configured: 'GitHub chưa được cấu hình. Hãy thêm GITHUB_CLIENT_ID và GITHUB_CLIENT_SECRET vào backend/.env rồi khởi động lại server.',
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
  accountMenu.querySelectorAll('[data-room-view]').forEach((button) => {
    button.addEventListener('click', closeAccountMenu);
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
    hasCachedRooms = true;
    saveDashboardCache('rooms', roomCache);
    document.dispatchEvent(new Event('rooms-updated'));
    document.dispatchEvent(new Event('dashboard-data-updated'));
    renderRoomList();
    updateBookingRoomOptions();
  } catch (error) {
    if (!hasCachedRooms) roomGrid.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    else showRoomFeedback('Không thể đồng bộ dữ liệu phòng mới. Đang hiển thị dữ liệu đã tải trước đó.', 'error');
    document.dispatchEvent(new CustomEvent('rooms-error', { detail: error.message }));
    throw error;
  }
}

function renderBookingList() {
  const bookingList = document.querySelector('#booking-list');
  if (!bookingList) return;
  const selectedStatus = document.querySelector('[data-booking-status].active')?.dataset.bookingStatus || '';
  const searchTerm = (document.querySelector('#booking-search')?.value || '').trim().toLocaleLowerCase('vi');
  const checkInFrom = document.querySelector('#booking-from-date')?.value || '';
  const checkOutTo = document.querySelector('#booking-to-date')?.value || '';
  const statusCounts = {
    all: bookingCache.length,
    pending: bookingCache.filter(booking => booking.status === 'pending').length,
    'checked-in': bookingCache.filter(booking => booking.status === 'checked_in').length,
    'checked-out': bookingCache.filter(booking => booking.status === 'checked_out').length,
    cancelled: bookingCache.filter(booking => booking.status === 'cancelled').length
  };
  for (const [status, count] of Object.entries(statusCounts)) {
    const countElement = document.querySelector(`#booking-count-${status}`);
    if (countElement) countElement.textContent = count;
  }
  const bookings = bookingCache.filter(booking => {
    const text = `${booking.id} ${booking.customerName || ''} ${booking.customerPhone || ''} ${booking.roomCode || ''}`.toLocaleLowerCase('vi');
    const checkInDate = String(booking.scheduledCheckInAt || '').slice(0, 10);
    const checkOutDate = String(booking.scheduledCheckOutAt || '').slice(0, 10);
    return (!selectedStatus || booking.status === selectedStatus)
      && text.includes(searchTerm)
      && (!checkInFrom || checkInDate >= checkInFrom)
      && (!checkOutTo || checkOutDate <= checkOutTo);
  });
  const pageCount = Math.max(1, Math.ceil(bookings.length / bookingPageSize));
  bookingPage = Math.min(bookingPage, pageCount);
  const pageBookings = bookings.slice((bookingPage - 1) * bookingPageSize, bookingPage * bookingPageSize);
  if (!bookings.some(booking => String(booking.id) === String(selectedBookingId))) {
    selectedBookingId = bookings[0]?.id ?? null;
  }
  const statusLabels = { pending: 'Đang chờ', checked_in: 'Đang ở', checked_out: 'Đã trả', cancelled: 'Đã hủy' };
  const statusClasses = { pending: 'reserved', checked_in: 'occupied', checked_out: 'cleaning', cancelled: 'cancelled' };
  const formatTotal = booking => {
    const room = roomCache.find(item => String(item.id) === String(booking.roomId));
    const hourlyRate = Number(booking.hourlyRate ?? room?.hourlyRate ?? room?.hourly_rate);
    const checkIn = new Date(booking.scheduledCheckInAt);
    const checkOut = new Date(booking.scheduledCheckOutAt);
    const durationMinutes = (checkOut - checkIn) / 60000;
    const estimatedTotal = Number.isFinite(hourlyRate) && checkOut > checkIn
      ? hourlyRate * Math.ceil(durationMinutes / 60)
      : null;
    const total = booking.rentalTotal ?? estimatedTotal;
    return total === null ? '—' : `${Number(total).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`;
  };

  bookingList.innerHTML = bookings.length
    ? `<div class="management-table-wrap"><table class="management-table booking-table">
        <thead><tr><th>Mã đặt phòng</th><th>Khách hàng</th><th>Phòng</th><th>Ngày nhận</th><th>Ngày trả</th><th>Số khách</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>${pageBookings.map(booking => {
        const room = roomCache.find(item => String(item.id) === String(booking.roomId));
        const roomCode = room?.roomCode || room?.room_code || booking.roomCode || '—';
        const statusClass = statusClasses[booking.status] || 'reserved';
        return `<tr class="booking-row ${statusClass}${String(booking.id) === String(selectedBookingId) ? ' selected' : ''}">
          <td><strong class="booking-code">DP${String(booking.id).padStart(3, '0')}</strong></td>
          <td><strong>${escapeHtml(booking.customerName || 'Chưa có thông tin')}</strong><small>${escapeHtml(booking.customerPhone || '—')}</small></td>
          <td>${escapeHtml(roomCode)}</td>
          <td>${escapeHtml(formatBookingDate(booking.scheduledCheckInAt))}</td>
          <td>${escapeHtml(formatBookingDate(booking.scheduledCheckOutAt))}</td>
          <td>${escapeHtml(booking.guestCount || 1)}</td>
          <td class="booking-total">${formatTotal(booking)}</td>
          <td><span class="booking-status ${statusClass}">${escapeHtml(statusLabels[booking.status] || booking.status)}</span></td>
          <td><button type="button" class="booking-action" data-booking-select="${escapeHtml(booking.id)}">Chi tiết</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <div class="booking-list-footer">
        <span>Hiển thị ${(bookingPage - 1) * bookingPageSize + 1}–${Math.min(bookingPage * bookingPageSize, bookings.length)} trong ${bookings.length} đặt phòng</span>
        <nav class="booking-pagination" aria-label="Phân trang đặt phòng">
          <button type="button" data-booking-page="${bookingPage - 1}" aria-label="Trang trước" ${bookingPage === 1 ? 'disabled' : ''}>‹</button>
          ${Array.from({ length: pageCount }, (_, index) => index + 1).map(page => `<button type="button" data-booking-page="${page}" class="${page === bookingPage ? 'active' : ''}" aria-current="${page === bookingPage ? 'page' : 'false'}">${page}</button>`).join('')}
          <button type="button" data-booking-page="${bookingPage + 1}" aria-label="Trang sau" ${bookingPage === pageCount ? 'disabled' : ''}>›</button>
        </nav>
      </div>`
    : `<div class="room-empty">${bookingCache.length ? 'Không tìm thấy đặt phòng phù hợp.' : 'Chưa có đặt phòng nào.'}</div>`;

  renderBookingDetails(bookings.find(booking => String(booking.id) === String(selectedBookingId)));
}

function renderBookingDetails(booking) {
  const detailCard = document.querySelector('#booking-detail-card');
  if (!detailCard) return;
  if (!booking) {
    detailCard.innerHTML = '<div class="booking-detail-empty"><span aria-hidden="true">＋</span><h3>Chi tiết đặt phòng</h3><p>Chọn một đặt phòng trong danh sách để xem thông tin.</p></div>';
    return;
  }

  const room = roomCache.find(item => String(item.id) === String(booking.roomId));
  const customer = customerCache.find(item => String(item.id) === String(booking.customerId));
  const roomCode = room?.roomCode || room?.room_code || booking.roomCode || '—';
  const roomType = roomTypeLabel(room?.roomType || room?.room_type || '');
  const roomImage = room?.imagePath || room?.image_path || '/assets/room-placeholder.svg';
  const statusLabels = { pending: 'Đang chờ', checked_in: 'Đang ở', checked_out: 'Đã trả', cancelled: 'Đã hủy' };
  const statusClass = { pending: 'reserved', checked_in: 'occupied', checked_out: 'cleaning', cancelled: 'cancelled' }[booking.status] || 'reserved';
  const hourlyRate = Number(booking.hourlyRate ?? room?.hourlyRate ?? room?.hourly_rate);
  const checkIn = new Date(booking.scheduledCheckInAt);
  const checkOut = new Date(booking.scheduledCheckOutAt);
  const durationMinutes = (checkOut - checkIn) / 60000;
  const estimatedTotal = Number.isFinite(hourlyRate) && checkOut > checkIn
    ? hourlyRate * Math.ceil(durationMinutes / 60)
    : null;
  const total = booking.rentalTotal ?? estimatedTotal;
  const actions = booking.status === 'pending'
    ? `<button type="button" class="booking-detail-action" data-booking-action="check-in" data-booking-id="${escapeHtml(booking.id)}">Nhận phòng</button><button type="button" class="booking-detail-action danger" data-booking-action="cancel" data-booking-id="${escapeHtml(booking.id)}">Hủy đặt phòng</button>`
    : booking.status === 'checked_in'
      ? `<button type="button" class="booking-detail-action" data-booking-action="check-out" data-booking-id="${escapeHtml(booking.id)}">Trả phòng</button>`
      : '';

  detailCard.innerHTML = `<div class="booking-detail-heading"><h3><span aria-hidden="true">⊕</span> Chi tiết đặt phòng</h3><span class="booking-detail-code">DP${String(booking.id).padStart(3, '0')}</span></div>
    <div class="booking-detail-room">
      <img src="${escapeHtml(roomImage)}" alt="Ảnh phòng ${escapeHtml(roomCode)}" />
      <div><div class="booking-detail-room-title"><strong>Phòng ${escapeHtml(roomCode)}</strong><span class="booking-status ${statusClass}">${escapeHtml(statusLabels[booking.status] || booking.status)}</span></div>
        <small>${escapeHtml(roomType || 'Phòng lưu trú')}</small>
        <span class="booking-detail-rate">${Number.isFinite(hourlyRate) ? `${hourlyRate.toLocaleString('vi-VN')}đ/giờ` : 'Chưa có giá phòng'}</span>
        <span class="booking-detail-guests">${escapeHtml(booking.guestCount || 1)} khách</span>
      </div>
    </div>
    <div class="booking-detail-columns">
      <section><h4>Thông tin khách hàng</h4><dl>
        <div><dt>Họ và tên</dt><dd>${escapeHtml(booking.customerName || customer?.fullName || '—')}</dd></div>
        <div><dt>Số điện thoại</dt><dd>${escapeHtml(booking.customerPhone || customer?.phone || '—')}</dd></div>
        <div><dt>CMND/CCCD</dt><dd>${escapeHtml(booking.customerIdentity || customer?.identityNumber || '—')}</dd></div>
      </dl></section>
      <section><h4>Thông tin đặt phòng</h4><dl>
        <div><dt>Ngày nhận phòng</dt><dd>${escapeHtml(formatBookingDateTime(booking.scheduledCheckInAt))}</dd></div>
        <div><dt>Ngày trả phòng</dt><dd>${escapeHtml(formatBookingDateTime(booking.scheduledCheckOutAt))}</dd></div>
        <div><dt>Số khách</dt><dd>${escapeHtml(booking.guestCount || 1)} người</dd></div>
        <div><dt>Tổng tiền</dt><dd class="booking-detail-total">${total === null ? '—' : `${Number(total).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`}</dd></div>
      </dl></section>
    </div>
    <p class="booking-detail-notes"><strong>Ghi chú</strong><span>${escapeHtml(booking.notes || booking.note || 'Không có ghi chú.')}</span></p>
    ${actions ? `<div class="booking-detail-actions">${actions}</div>` : ''}`;
  detailCard.querySelector('.booking-detail-room img')?.addEventListener('error', event => {
    event.currentTarget.src = '/assets/room-placeholder.svg';
  }, { once: true });
}

function upsertBookingCache(booking) {
  const existing = bookingCache.find(item => String(item.id) === String(booking.id));
  const updated = { ...existing, ...booking };
  for (const field of ['customerName', 'customerPhone', 'customerIdentity', 'customerEmail']) {
    if (!updated[field]) updated[field] = existing?.[field] || '';
  }
  bookingCache = [updated, ...bookingCache.filter(item => String(item.id) !== String(booking.id))];
  selectedBookingId = updated.id;
  document.dispatchEvent(new Event('dashboard-data-updated'));
}

async function loadBookingList() {
  const bookingList = document.querySelector('#booking-list');
  if (!bookingList) return;
  try {
    const response = await fetch('/api/bookings');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách đặt phòng.');
    bookingCache = result.bookings || [];
    renderBookingList();
    renderCheckoutList();
    document.dispatchEvent(new Event('dashboard-bookings-loaded'));
    document.dispatchEvent(new Event('dashboard-data-updated'));
    if (customerCache.length) renderCustomerList();
  } catch (error) {
    bookingList.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    document.dispatchEvent(new CustomEvent('dashboard-bookings-error', { detail: error.message }));
    throw error;
  }
}

function renderCustomerList() {
  const tableBody = document.querySelector('#customer-table-body');
  if (!tableBody) return;
  const query = (document.querySelector('#customer-search')?.value || '').trim().toLocaleLowerCase('vi');
  const statusFilter = document.querySelector('#customer-status-filter')?.value || 'all';
  const genderFilter = document.querySelector('#customer-gender-filter')?.value || 'all';
  const sortBy = document.querySelector('#customer-sort')?.value || 'recent';
  const statusForCustomer = (customer) => {
    const customerBookings = bookingCache.filter(booking => String(booking.customerId) === String(customer.id));
    if (customerBookings.some(booking => booking.status === 'checked_in')) return 'staying';
    if (customerBookings.some(booking => booking.status === 'pending')) return 'upcoming';
    if (customerBookings.some(booking => booking.status === 'checked_out')) return 'served';
    if (customerBookings.some(booking => booking.status === 'cancelled')) return 'cancelled';
    return 'none';
  };
  const matchingCustomers = customerCache.filter(customer => {
    const matchesQuery = `${customer.fullName} ${customer.phone} ${customer.identityNumber || ''} ${customer.email || ''}`
      .toLocaleLowerCase('vi').includes(query);
    const status = statusForCustomer(customer);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'not-staying' ? status !== 'staying' : status === statusFilter);
    const matchesGender = genderFilter === 'all' || customer.gender === genderFilter;
    return matchesQuery && matchesStatus && matchesGender;
  });
  const customers = [...matchingCustomers].sort((a, b) => {
    if (sortBy === 'name') return String(a.fullName || '').localeCompare(String(b.fullName || ''), 'vi');
    if (sortBy === 'bookings') return Number(b.bookingCount || 0) - Number(a.bookingCount || 0);
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      || Number(b.id || 0) - Number(a.id || 0);
  });
  const now = new Date();
  const newThisMonth = customerCache.filter(customer => {
    const created = new Date(customer.createdAt);
    return Number.isFinite(created.getTime())
      && created.getFullYear() === now.getFullYear()
      && created.getMonth() === now.getMonth();
  }).length;
  const stayingBookings = bookingCache.filter(booking => booking.status === 'checked_in');
  const stayingCustomers = new Set(stayingBookings.map(booking => String(booking.customerId)));
  document.querySelector('#customer-stat-total').textContent = customerCache.length.toLocaleString('vi-VN');
  document.querySelector('#customer-stat-new').textContent = newThisMonth.toLocaleString('vi-VN');
  document.querySelector('#customer-stat-staying').textContent = stayingCustomers.size.toLocaleString('vi-VN');
  document.querySelector('#customer-stat-not-staying').textContent = Math.max(0, customerCache.length - stayingCustomers.size).toLocaleString('vi-VN');
  const statusCounts = {
    all: customerCache.length,
    staying: stayingCustomers.size,
    'not-staying': Math.max(0, customerCache.length - stayingCustomers.size)
  };
  document.querySelectorAll('[data-customer-status]').forEach(button => {
    const status = button.dataset.customerStatus;
    const countElement = button.querySelector('span');
    if (countElement) countElement.textContent = statusCounts[status].toLocaleString('vi-VN');
    const active = status === statusFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const count = document.querySelector('#customer-count');
  if (count) count.textContent = `Hiển thị ${customers.length} / ${customerCache.length} khách hàng`;
  const pageCount = Math.max(1, Math.ceil(customers.length / customerPageSize));
  customerPage = Math.min(customerPage, pageCount);
  const pageCustomers = customers.slice((customerPage - 1) * customerPageSize, customerPage * customerPageSize);
  const labelForStatus = {
    staying: ['Đang ở', 'staying'],
    upcoming: ['Đã đặt', 'upcoming'],
    served: ['Đã trả', 'served'],
    cancelled: ['Đã hủy', 'cancelled'],
    none: ['Chưa đặt', 'none']
  };
  tableBody.innerHTML = pageCustomers.length
    ? pageCustomers.map((customer, index) => {
        const status = labelForStatus[statusForCustomer(customer)];
        const latestBooking = bookingCache
          .filter(booking => String(booking.customerId) === String(customer.id))
          .sort((a, b) => String(b.scheduledCheckInAt || '').localeCompare(String(a.scheduledCheckInAt || '')))[0];
        const initials = String(customer.fullName || '?').trim().split(/\s+/).slice(-2).map(name => name[0]).join('').toUpperCase().slice(0, 2) || 'KH';
        const roomCode = latestBooking?.roomCode || latestBooking?.room_code || '—';
        const selected = String(customer.id) === String(selectedCustomerId);
        const customerStatus = status[1] === 'staying' ? ['Đang ở', 'staying'] : ['Chưa ở', 'none'];
        return `<article class="customer-card ${selected ? 'is-selected' : ''}" data-customer-id="${escapeHtml(customer.id)}" tabindex="0" aria-selected="${selected}">
          <div class="customer-card-header">
            <div class="customer-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
            <div class="customer-card-details">
              <div class="customer-card-meta-top">
                <h4>${escapeHtml(customer.fullName || '—')}</h4>
                <span class="customer-status-badge ${customerStatus[1]}"><i></i>${customerStatus[0]}</span>
              </div>
            </div>
          </div>
          <div class="customer-contact-list">
            <div class="customer-contact-item"><span class="contact-icon" aria-hidden="true">☎</span><span>${escapeHtml(customer.phone || '—')}</span></div>
            <div class="customer-contact-item"><span class="contact-icon" aria-hidden="true">▣</span><span>${escapeHtml(customer.identityNumber || '—')}</span></div>
            <div class="customer-contact-item"><span class="contact-icon" aria-hidden="true">✉</span><span>${escapeHtml(customer.email || '—')}</span></div>
          </div>
          <div class="customer-card-meta customer-card-summary">
            <span><i aria-hidden="true">▦</i> ${Number(customer.bookingCount || 0)} lần đặt</span>
            <span><i aria-hidden="true">▰</i> ${escapeHtml(roomCode)}</span>
          </div>
          <div class="customer-card-actions">
            <button type="button" class="customer-card-view" data-customer-id="${escapeHtml(customer.id)}"><span aria-hidden="true">◉</span> Chi tiết</button>
            <button type="button" class="customer-card-edit secondary" data-customer-id="${escapeHtml(customer.id)}"><span aria-hidden="true">✎</span> Chỉnh sửa</button>
          </div>
        </article>`;
      }).join('')
    : `<div class="customer-card-empty">${customerCache.length ? 'Không tìm thấy khách hàng phù hợp.' : 'Chưa có khách hàng. Hãy thêm khách hàng để bắt đầu tạo đặt phòng.'}</div>`;
  document.querySelector('#customer-page-summary').textContent = customers.length
    ? `Hiển thị ${(customerPage - 1) * customerPageSize + 1} - ${Math.min(customerPage * customerPageSize, customers.length)} trong ${customers.length} khách hàng`
    : 'Không có khách hàng';
  document.querySelector('#customer-page-number').textContent = `${customerPage} / ${pageCount}`;
  document.querySelector('#customer-page-prev').disabled = customerPage <= 1;
  document.querySelector('#customer-page-next').disabled = customerPage >= pageCount;
  if (!pageCustomers.some(customer => String(customer.id) === String(selectedCustomerId))) {
    selectedCustomerId = pageCustomers[0]?.id ?? null;
  }
  renderCustomerDetails();
  updateBookingCustomerOptions();
  renderBookingDetails(bookingCache.find(booking => String(booking.id) === String(selectedBookingId)));
}

function renderCustomerDetails() {
  const panel = document.querySelector('#customer-detail-panel');
  if (!panel) return;
  const customer = customerCache.find(item => String(item.id) === String(selectedCustomerId));
  if (!customer) {
    panel.innerHTML = '<div class="customer-detail-empty">Chọn một khách hàng trong danh sách để xem hồ sơ và lịch sử đặt phòng.</div>';
    return;
  }
  const history = bookingCache
    .filter(booking => String(booking.customerId) === String(customer.id))
    .sort((a, b) => String(b.scheduledCheckInAt || '').localeCompare(String(a.scheduledCheckInAt || '')));
  const latestBooking = history[0];
  const initials = String(customer.fullName || '?').trim().split(/\s+/).slice(-2).map(name => name[0]).join('').toLocaleUpperCase('vi');
  const labels = { pending: ['Đã đặt', 'upcoming'], checked_in: ['Đang ở', 'staying'], checked_out: ['Đã trả', 'served'], cancelled: ['Đã hủy', 'cancelled'] };
  const completedSpend = history
    .filter(booking => booking.status === 'checked_out')
    .reduce((sum, booking) => sum + (Number(booking.rentalTotal) || 0), 0);
  panel.innerHTML = `<div class="customer-detail-dialog">
    <div class="customer-detail-heading"><span class="customer-avatar">${escapeHtml(initials)}</span><div><h3>${escapeHtml(customer.fullName || '—')}</h3><p>Mã khách hàng: KH${escapeHtml(String(customer.id).padStart(4, '0'))}</p></div><button type="button" id="customer-detail-close" class="customer-modal-close" aria-label="Đóng chi tiết khách hàng">×</button></div>
    <dl class="customer-detail-fields">
      <div><dt>Điện thoại</dt><dd>${escapeHtml(customer.phone || 'Chưa cập nhật')}</dd></div>
      <div><dt>CCCD/Căn cước</dt><dd>${escapeHtml(customer.identityNumber || 'Chưa cập nhật')}</dd></div>
      <div><dt>Email</dt><dd>${escapeHtml(customer.email || 'Chưa cập nhật')}</dd></div>
      <div><dt>Ngày sinh</dt><dd>${escapeHtml(customer.dateOfBirth ? formatBookingDate(customer.dateOfBirth) : 'Chưa cập nhật')}</dd></div>
      <div><dt>Giới tính</dt><dd>${escapeHtml({ male: 'Nam', female: 'Nữ', other: 'Khác' }[customer.gender] || 'Chưa cập nhật')}</dd></div>
      <div><dt>Địa chỉ</dt><dd>${escapeHtml(customer.address || 'Chưa cập nhật')}</dd></div>
    </dl>
    ${customer.notes ? `<div class="customer-profile-notes"><strong>Ghi chú</strong><p>${escapeHtml(customer.notes)}</p></div>` : ''}
    <h4 class="customer-detail-section-title">Thống kê đặt phòng</h4>
    <div class="customer-booking-stats"><div><span>Số lần đặt</span><strong>${Number(customer.bookingCount || history.length)}</strong></div><div><span>Tổng chi tiêu đã trả</span><strong>${completedSpend.toLocaleString('vi-VN')} đ</strong></div><div><span>Lần gần nhất</span><strong>${latestBooking ? escapeHtml(formatBookingDate(latestBooking.scheduledCheckInAt)) : 'Chưa có'}</strong></div></div>
    <div class="customer-detail-history"><h4>Lịch sử đặt phòng</h4>${history.length
      ? history.slice(0, 5).map(booking => {
          const status = labels[booking.status] || ['Không rõ', 'none'];
          return `<div class="customer-history-row"><span><strong>Phòng ${escapeHtml(booking.roomCode || '—')}</strong><small>${escapeHtml(formatBookingDateTime(booking.scheduledCheckInAt))}</small></span><span class="customer-status-badge ${status[1]}">${status[0]}</span></div>`;
        }).join('')
      : '<p class="muted">Khách hàng chưa có lịch sử đặt phòng.</p>'}</div>
    </div>`;
}

function updateBookingCustomerOptions() {
  const customerOptions = document.querySelector('#booking-customer-options');
  if (!customerOptions) return;
  customerOptions.innerHTML = customerCache
    .map(customer => `<option value="${escapeHtml(customer.fullName)}" label="${escapeHtml(customer.phone || '')}"></option>`)
    .join('');
}

function updateBookingRoomOptions() {
  const roomSelect = document.querySelector('#booking-room');
  if (!roomSelect) return;
  const selectedId = roomSelect.value;
  const availableRooms = roomCache.filter(room =>
    roomStatusInfo(room.status).className === 'available'
    && Number(room.hourlyRate ?? room.hourly_rate) > 0
  );
  roomSelect.innerHTML = '<option value="">Chọn phòng trống</option>' + availableRooms
    .map(room => {
      const roomCode = room.roomCode || room.room_code || '';
      const hourlyRate = Number(room.hourlyRate ?? room.hourly_rate) || 0;
      return `<option value="${escapeHtml(room.id)}">${escapeHtml(roomCode)} · ${escapeHtml(roomTypeLabel(room.roomType || room.room_type || ''))} · ${hourlyRate.toLocaleString('vi-VN')}đ/giờ</option>`;
    }).join('');
  if (availableRooms.some(room => String(room.id) === selectedId)) roomSelect.value = selectedId;
}

async function loadCustomers() {
  const customerTableBody = document.querySelector('#customer-table-body');
  if (!customerTableBody) return;
  try {
    const response = await fetch('/api/customers');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách khách hàng.');
    customerCache = result.customers || [];
    renderCustomerList();
    document.dispatchEvent(new Event('dashboard-customers-loaded'));
    document.dispatchEvent(new Event('dashboard-data-updated'));
  } catch (error) {
    document.querySelector('#customer-table-body').innerHTML = `<tr><td colspan="8" class="customer-table-error">${escapeHtml(error.message || 'Không thể tải danh sách khách hàng.')}</td></tr>`;
    document.dispatchEvent(new CustomEvent('dashboard-customers-error', { detail: error.message || 'Không thể tải danh sách khách hàng.' }));
  }
}

const bookingForm = document.querySelector('#booking-form');
const bookingFormCard = document.querySelector('#booking-form-card');
if (bookingForm && bookingFormCard) {
  const bookingSuccessDialog = document.querySelector('#booking-success-dialog');
  let successfulBookingId = null;
  const showBookingSuccess = booking => {
    if (!bookingSuccessDialog) {
      showRoomFeedback('Đặt phòng thành công.');
      return;
    }
    const room = roomCache.find(item => String(item.id) === String(booking.roomId));
    const customer = customerCache.find(item => String(item.id) === String(booking.customerId));
    const hourlyRate = Number(booking.hourlyRate ?? room?.hourlyRate ?? room?.hourly_rate);
    const checkIn = new Date(booking.scheduledCheckInAt);
    const checkOut = new Date(booking.scheduledCheckOutAt);
    const estimatedTotal = Number.isFinite(hourlyRate) && checkOut > checkIn
      ? hourlyRate * Math.ceil((checkOut - checkIn) / 3600000)
      : null;
    const total = booking.rentalTotal ?? estimatedTotal;
    const statusLabel = { pending: 'Đã đặt', checked_in: 'Đang ở', checked_out: 'Đã trả', cancelled: 'Đã hủy' }[booking.status] || booking.status || 'Đã đặt';
    successfulBookingId = booking.id;
    document.querySelector('#booking-success-code').textContent = `DP${String(booking.id).padStart(3, '0')}`;
    document.querySelector('#booking-success-customer').textContent = booking.customerName || customer?.fullName || '—';
    document.querySelector('#booking-success-room').textContent = `Phòng ${booking.roomCode || room?.roomCode || room?.room_code || '—'} · ${roomTypeLabel(room?.roomType || room?.room_type || '') || 'Phòng lưu trú'}`;
    document.querySelector('#booking-success-check-in').textContent = formatBookingDateTime(booking.scheduledCheckInAt);
    document.querySelector('#booking-success-check-out').textContent = formatBookingDateTime(booking.scheduledCheckOutAt);
    document.querySelector('#booking-success-total').textContent = total === null ? '—' : `${Number(total).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ`;
    document.querySelector('#booking-success-status').textContent = statusLabel;
    bookingSuccessDialog.showModal();
  };
  const syncBookingCustomerDetails = () => {
    const normalizeName = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
    const fullName = normalizeName(document.querySelector('#booking-customer-name').value);
    const matchingCustomers = customerCache.filter(customer => normalizeName(customer.fullName) === fullName);
    if (matchingCustomers.length !== 1) return;
    const customer = matchingCustomers[0];
    document.querySelector('#booking-customer-phone').value = customer.phone || '';
    document.querySelector('#booking-customer-identity').value = customer.identityNumber || '';
    document.querySelector('#booking-customer-email').value = customer.email || '';
    document.querySelector('#booking-customer-address').value = customer.address || '';
  };
  const updateBookingSummary = () => {
    const room = roomCache.find(item => String(item.id) === document.querySelector('#booking-room').value);
    const image = document.querySelector('#booking-room-image');
    const rateElement = document.querySelector('#booking-room-rate');
    const hourlyRate = Number(room?.hourlyRate ?? room?.hourly_rate);
    image.src = room?.imagePath || room?.image_path || '/assets/room-placeholder.svg';
    rateElement.textContent = room && Number.isFinite(hourlyRate)
      ? `${hourlyRate.toLocaleString('vi-VN')}đ / giờ`
      : 'Đơn giá sẽ hiển thị khi chọn phòng';
    const checkIn = new Date(document.querySelector('#booking-check-in').value);
    const checkOut = new Date(document.querySelector('#booking-check-out').value);
    const durationMinutes = checkOut > checkIn ? (checkOut - checkIn) / 60000 : null;
    const billableHours = durationMinutes === null ? null : Math.ceil(durationMinutes / 60);
    document.querySelector('#booking-night-count').textContent = billableHours === null
      ? '—'
      : `${billableHours} giờ (làm tròn lên)`;
    document.querySelector('#booking-total').textContent = billableHours !== null && Number.isFinite(hourlyRate)
      ? `${(hourlyRate * billableHours).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ`
      : '—';
  };
  bookingSuccessDialog?.querySelectorAll('[data-booking-success-close]').forEach(button => {
    button.addEventListener('click', () => bookingSuccessDialog.close());
  });
  bookingSuccessDialog?.querySelector('[data-booking-success-details]')?.addEventListener('click', () => {
    if (successfulBookingId === null) return;
    selectedBookingId = successfulBookingId;
    bookingPage = 1;
    document.querySelector('#booking-search').value = '';
    document.querySelector('#booking-from-date').value = '';
    document.querySelector('#booking-to-date').value = '';
    document.querySelector('#booking-status-select').value = '';
    document.querySelectorAll('[data-booking-status]').forEach(button => {
      button.classList.toggle('active', button.dataset.bookingStatus === '');
    });
    bookingSuccessDialog.close();
    document.querySelector('[data-room-view="booking"]').click();
  });
  const setDefaultBookingDates = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    const localValue = date => {
      const pad = part => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const checkIn = document.querySelector('#booking-check-in');
    const checkOut = document.querySelector('#booking-check-out');
    checkIn.min = localValue(now);
    checkOut.min = localValue(now);
    if (!checkIn.value) checkIn.value = localValue(now);
    if (!checkOut.value) checkOut.value = localValue(new Date(now.getTime() + 86400000));
  };
  const showBookingForm = () => {
    updateBookingCustomerOptions();
    updateBookingRoomOptions();
    setDefaultBookingDates();
    updateBookingSummary();
    bookingFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('#booking-customer-name').focus();
  };
  setDefaultBookingDates();
  const resetBookingForm = () => {
    bookingForm.reset();
    setDefaultBookingDates();
    document.querySelector('#booking-form-error').textContent = '';
    updateBookingSummary();
  };
  document.querySelector('#booking-form-toggle')?.addEventListener('click', showBookingForm);
  document.querySelector('#booking-form-dismiss')?.addEventListener('click', resetBookingForm);
  document.querySelector('#booking-customer-name')?.addEventListener('change', syncBookingCustomerDetails);
  document.querySelector('#booking-room')?.addEventListener('change', updateBookingSummary);
  document.querySelector('#booking-check-in')?.addEventListener('change', updateBookingSummary);
  document.querySelector('#booking-check-out')?.addEventListener('change', updateBookingSummary);
  document.querySelector('#booking-guest-count')?.addEventListener('change', event => {
    const guestCount = Number(event.currentTarget.value);
    event.currentTarget.value = String(Math.min(20, Math.max(1, Number.isFinite(guestCount) ? guestCount : 1)));
  });
  bookingForm.querySelectorAll('[data-guest-step]').forEach(button => {
    button.addEventListener('click', () => {
      const guestCount = document.querySelector('#booking-guest-count');
      guestCount.value = String(Math.min(20, Math.max(1, Number(guestCount.value) + Number(button.dataset.guestStep))));
      guestCount.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  document.querySelector('#booking-check-in')?.addEventListener('change', event => {
    const checkIn = new Date(event.target.value);
    if (!Number.isFinite(checkIn.getTime())) return;
    const checkOut = document.querySelector('#booking-check-out');
    const localValue = date => {
      const pad = part => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    checkOut.min = localValue(checkIn);
    if (!checkOut.value || new Date(checkOut.value) <= checkIn) {
      checkOut.value = localValue(new Date(checkIn.getTime() + 3600000));
    }
    updateBookingSummary();
  });
  bookingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const errorMessage = document.querySelector('#booking-form-error');
    errorMessage.textContent = '';
    if (!bookingForm.reportValidity()) return;
    const formData = new FormData(bookingForm);
    const customerData = {
      fullName: String(formData.get('customerName') || '').trim(),
      phone: String(formData.get('customerPhone') || '').trim(),
      identityNumber: String(formData.get('customerIdentity') || '').trim(),
      email: String(formData.get('customerEmail') || '').trim(),
      address: String(formData.get('customerAddress') || '').trim()
    };
    const normalizedPhone = customerData.phone.replace(/\s+/g, '');
    const existingCustomer = customerCache.find(customer => String(customer.phone || '').replace(/\s+/g, '') === normalizedPhone);
    const identityNumber = customerData.identityNumber;
    const identityCustomer = identityNumber
      ? customerCache.find(customer => customer.identityNumber === identityNumber)
      : null;
    if (identityCustomer && String(identityCustomer.id) !== String(existingCustomer?.id)) {
      errorMessage.textContent = 'Số CCCD/Căn cước này đã được sử dụng bởi khách hàng khác.';
      return;
    }
    let customerId;
    if (existingCustomer) {
      if (existingCustomer.fullName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi') !== customerData.fullName.replace(/\s+/g, ' ').toLocaleLowerCase('vi')) {
        errorMessage.textContent = 'Số điện thoại này đã thuộc về khách hàng khác. Hãy kiểm tra lại thông tin.';
        return;
      }
      customerId = existingCustomer.id;
    }
    const payload = Object.fromEntries(formData.entries());
    delete payload.customerName;
    delete payload.customerPhone;
    delete payload.customerIdentity;
    delete payload.customerEmail;
    delete payload.customerAddress;
    payload.guestCount = Number(payload.guestCount);
    if (new Date(payload.checkOutAt) <= new Date(payload.checkInAt)) {
      errorMessage.textContent = 'Ngày trả phòng phải sau ngày nhận phòng.';
      return;
    }
    const submitButton = bookingForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      if (customerId === undefined) {
        const customerResponse = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customerData)
        });
        const customerResult = await customerResponse.json();
        if (!customerResponse.ok) throw new Error(customerResult.message || 'Không thể lưu thông tin khách hàng.');
        customerCache = [...customerCache, customerResult.customer];
        document.dispatchEvent(new Event('dashboard-data-updated'));
        customerId = customerResult.customer.id;
      }
      payload.customerId = customerId;
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể tạo đặt phòng.');
      if (result.booking) upsertBookingCache(result.booking);
      if (result.room) roomCache = roomCache.map(room => String(room.id) === String(result.room.id) ? result.room : room);
      resetBookingForm();
      renderBookingList();
      renderRoomList();
      updateBookingRoomOptions();
      await loadCustomers();
      document.dispatchEvent(new Event('rooms-updated'));
      document.querySelector('.room-navigation [data-room-view="list"]')?.click();
      if (result.booking) showBookingSuccess(result.booking);
      else showRoomFeedback(result.message || 'Đặt phòng thành công.');
    } catch (error) {
      errorMessage.textContent = error.message || 'Không thể tạo đặt phòng.';
    } finally {
      submitButton.disabled = false;
    }
  });
}

const customerForm = document.querySelector('#customer-form');
const customerFormCard = document.querySelector('#customer-form-card');
if (customerForm && customerFormCard) {
  const customerFormTitle = document.querySelector('#customer-form-title');
  const customerFormDescription = document.querySelector('#customer-form-description');
  const customerSubmitButton = customerForm.querySelector('[type="submit"]');
  const showCustomerForm = (customer = null) => {
    editingCustomerId = customer?.id ?? null;
    customerForm.reset();
    if (customer) {
      for (const field of ['fullName', 'phone', 'identityNumber', 'email', 'dateOfBirth', 'address', 'notes']) {
        customerForm.elements.namedItem(field).value = customer[field] || '';
      }
      const genderInput = customerForm.querySelector(`[name="gender"][value="${CSS.escape(customer.gender || '')}"]`);
      if (genderInput) genderInput.checked = true;
    }
    const birthDateInput = customerForm.querySelector('[name="dateOfBirth"]');
    const today = new Date();
    birthDateInput.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    customerFormTitle.textContent = customer ? 'Chỉnh sửa khách hàng' : 'Thêm khách hàng';
    customerFormDescription.textContent = customer
      ? 'Cập nhật thông tin hồ sơ khách hàng.'
      : 'Nhập thông tin khách hàng mới vào hệ thống.';
    customerSubmitButton.innerHTML = customer
      ? '<span aria-hidden="true">✎</span> Lưu thay đổi'
      : '<span aria-hidden="true">▣</span> Thêm khách hàng';
    document.querySelector('#customer-form-error').textContent = '';
    customerFormCard.classList.remove('hidden-form');
    document.body.classList.add('customer-modal-open');
    customerFormCard.focus();
    customerForm.querySelector('[name="fullName"]').focus();
  };
  openCustomerEditForm = showCustomerForm;
  const hideCustomerForm = () => {
    customerForm.reset();
    document.querySelector('#customer-form-error').textContent = '';
    customerFormCard.classList.add('hidden-form');
    document.body.classList.remove('customer-modal-open');
    editingCustomerId = null;
    customerFormTitle.textContent = 'Thêm khách hàng';
    customerFormDescription.textContent = 'Nhập thông tin khách hàng mới vào hệ thống.';
    customerSubmitButton.innerHTML = '<span aria-hidden="true">▣</span> Thêm khách hàng';
    document.querySelector('#customer-form-toggle')?.focus();
  };
  document.querySelector('#customer-form-toggle')?.addEventListener('click', showCustomerForm);
  document.querySelector('#customer-form-cancel')?.addEventListener('click', hideCustomerForm);
  document.querySelector('#customer-form-dismiss')?.addEventListener('click', hideCustomerForm);
  customerFormCard.addEventListener('click', event => {
    if (event.target === customerFormCard) hideCustomerForm();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !customerFormCard.classList.contains('hidden-form')) hideCustomerForm();
  });
  customerForm.addEventListener('submit', async event => {
    event.preventDefault();
    const errorMessage = document.querySelector('#customer-form-error');
    errorMessage.textContent = '';
    if (!customerForm.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(customerForm).entries());
    const isEditing = editingCustomerId !== null;
    customerSubmitButton.disabled = true;
    try {
      const endpoint = isEditing ? `/api/customers/${encodeURIComponent(editingCustomerId)}` : '/api/customers';
      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || (isEditing ? 'Không thể cập nhật khách hàng.' : 'Không thể thêm khách hàng.'));
      if (isEditing) {
        customerCache = customerCache.map(customer => String(customer.id) === String(result.customer.id)
          ? result.customer
          : customer);
      } else {
        customerCache = [...customerCache, result.customer];
        document.querySelector('#customer-search').value = '';
        document.querySelector('#customer-status-filter').value = 'all';
        document.querySelector('#customer-gender-filter').value = 'all';
        document.querySelector('#customer-sort').value = 'recent';
      }
      selectedCustomerId = result.customer.id;
      customerPage = 1;
      document.dispatchEvent(new Event('dashboard-data-updated'));
      hideCustomerForm();
      renderCustomerList();
      showRoomFeedback(result.message || (isEditing ? 'Đã cập nhật khách hàng.' : 'Đã thêm khách hàng.'));
    } catch (error) {
      errorMessage.textContent = error.message || (isEditing ? 'Không thể cập nhật khách hàng.' : 'Không thể thêm khách hàng.');
    } finally {
      customerSubmitButton.disabled = false;
    }
  });
}

document.querySelector('#customer-search')?.addEventListener('input', () => {
  customerPage = 1;
  renderCustomerList();
});
document.querySelector('#customer-status-filter')?.addEventListener('change', () => {
  customerPage = 1;
  renderCustomerList();
});
document.querySelectorAll('[data-customer-status]').forEach(button => {
  button.addEventListener('click', () => {
    const statusFilter = document.querySelector('#customer-status-filter');
    if (!statusFilter) return;
    statusFilter.value = button.dataset.customerStatus;
    statusFilter.dispatchEvent(new Event('change', { bubbles: true }));
  });
});
document.querySelector('#customer-gender-filter')?.addEventListener('change', () => {
  customerPage = 1;
  renderCustomerList();
});
document.querySelector('#customer-sort')?.addEventListener('change', () => {
  customerPage = 1;
  renderCustomerList();
});
document.querySelector('#customer-page-size')?.addEventListener('change', (event) => {
  customerPageSize = Number(event.target.value) || 8;
  customerPage = 1;
  renderCustomerList();
});
document.querySelector('#customer-page-prev')?.addEventListener('click', () => {
  customerPage = Math.max(1, customerPage - 1);
  renderCustomerList();
});
document.querySelector('#customer-page-next')?.addEventListener('click', () => {
  customerPage += 1;
  renderCustomerList();
});
document.querySelector('#customer-table-body')?.addEventListener('click', (event) => {
  const actionButton = event.target.closest('button[data-customer-id]');
  if (actionButton) {
    event.stopPropagation();
    const customer = customerCache.find(item => String(item.id) === String(actionButton.dataset.customerId));
    if (!customer) return;
    selectedCustomerId = customer.id;
    if (actionButton.classList.contains('customer-card-view')) {
      renderCustomerDetails();
      const detailPanel = document.querySelector('#customer-detail-panel');
      detailPanel.classList.remove('hidden-view');
      detailPanel.querySelector('#customer-detail-close')?.focus();
    } else if (actionButton.classList.contains('customer-card-edit')) {
      openCustomerEditForm?.(customer);
    }
    return;
  }
  const card = event.target.closest('.customer-card[data-customer-id]');
  if (!card) return;
  selectedCustomerId = card.dataset.customerId;
  renderCustomerList();
});
document.querySelector('#customer-table-body')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.customer-card[data-customer-id]');
  if (!card) return;
  if (event.target !== card) return;
  event.preventDefault();
  selectedCustomerId = card.dataset.customerId;
  renderCustomerList();
});
document.querySelector('#customer-detail-panel')?.addEventListener('click', (event) => {
  const panel = event.currentTarget;
  if (event.target === panel || event.target.closest('#customer-detail-close')) {
    panel.classList.add('hidden-view');
  }
});
document.addEventListener('keydown', event => {
  const detailPanel = document.querySelector('#customer-detail-panel');
  if (event.key === 'Escape' && detailPanel && !detailPanel.classList.contains('hidden-view')) {
    detailPanel.classList.add('hidden-view');
  }
});
document.querySelector('#booking-search')?.addEventListener('input', renderBookingList);
document.querySelector('#booking-from-date')?.addEventListener('change', renderBookingList);
document.querySelector('#booking-to-date')?.addEventListener('change', renderBookingList);
document.querySelectorAll('[data-booking-status]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-booking-status]').forEach(filter => filter.classList.toggle('active', filter === button));
    renderBookingList();
  });
});

async function handleBookingAction(action, bookingId, sourceButton = null) {
  const endpoint = `/api/bookings/${encodeURIComponent(bookingId)}/${action === 'check-in' ? 'check-in' : action === 'check-out' ? 'check-out' : 'cancel'}`;
  const method = action === 'cancel' ? 'PATCH' : 'PATCH';
  const button = sourceButton || document.querySelector(`[data-booking-action="${action}"][data-booking-id="${bookingId}"]`);
  if (button) button.disabled = true;
  try {
    const response = await fetch(endpoint, { method });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể xử lý đặt phòng.');
    if (result.booking) upsertBookingCache(result.booking);
    if (result.room) {
      roomCache = roomCache.map(item => String(item.id) === String(result.room.id) ? result.room : item);
    }
    await loadRoomList();
    renderBookingList();
    document.dispatchEvent(new Event('rooms-updated'));
    showRoomFeedback(result.message || 'Đã cập nhật đặt phòng thành công.');
  } catch (error) {
    showRoomFeedback(error.message || 'Không thể xử lý đặt phòng.', 'error');
    if (button) button.disabled = false;
  }
}

async function returnRoom(roomId, button, requestedBookingId = null) {
  const room = roomCache.find(item => String(item.id) === String(roomId));
  const activeBooking = bookingCache.find(item => String(item.roomId) === String(roomId) && item.status === 'checked_in');
  if (!room || (roomStatusInfo(room.status).className !== 'occupied' && !activeBooking)) {
    showRoomFeedback('Phòng hiện không được cho thuê.', 'error');
    return;
  }

  const dialog = document.querySelector('#checkout-room-dialog');
  if (!dialog) return;
  const roomCode = room.roomCode || room.room_code || room.roomNumber || '';
  const image = dialog.querySelector('#checkout-room-image');
  const checkIn = roomRentalField(room, 'checkInAt', 'checkInTime', 'check_in_time', 'checked_in_at');
  const checkOut = roomRentalField(room, 'checkOutAt', 'checkOutTime', 'check_out_time', 'checkout_time', 'checked_out_at');
  const bookingId = requestedBookingId || activeBooking?.id || room.bookingId || room.booking_id;
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
  const booking = bookingCache.find(item => String(item.roomId) === String(roomId) && item.status === 'checked_in');
  const total = bookingRentalQuote(booking) ?? roomRentalPrice(room);
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
  dialog.dataset.bookingId = bookingId ? String(bookingId) : '';
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
    try {
      const roomId = checkoutRoomDialog.dataset.roomId;
      const room = roomCache.find(item => String(item.id) === String(roomId));

      checkoutRoomDialog.dataset.step = 'loading';
    checkoutRoomDialog.querySelector('#checkout-room-error').textContent = '';
    checkoutSubmit.disabled = true;
    checkoutRoomDialog.querySelectorAll('[data-close-checkout]').forEach(button => { button.disabled = true; });
    setCheckoutStep('loading');
    const bookingId = checkoutRoomDialog.dataset.bookingId
      || bookingCache.find(item => String(item.roomId) === String(roomId) && item.status === 'checked_in')?.id
      || room?.bookingId || room?.booking_id;
    const response = bookingId
      ? await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/check-out`, { method: 'PATCH' })
      : await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Phòng trống' })
      });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Không thể trả phòng.');
    if (!result.room) throw new Error('Máy chủ không trả về thông tin phòng đã cập nhật.');

    if (result.booking) upsertBookingCache(result.booking);
    roomCache = roomCache.map(item => String(item.id) === String(result.room.id) ? result.room : item);
    renderBookingList();
    renderRoomList();
    document.dispatchEvent(new Event('rooms-updated'));
    checkoutRoomDialog.querySelector('#checkout-success-message').textContent = `Trả phòng thành công! Phòng ${room?.roomCode || room?.room_code || room?.roomNumber || ''} đang được dọn trong 30 phút.`;
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
  renderCheckoutList();
  updateBookingRoomOptions();
}

function renderCheckoutList() {
  const roomGrid = document.querySelector('#checkout-room-grid');
  if (!roomGrid) return;

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLocaleLowerCase('vi');
  const roomsById = new Map(roomCache.map(room => [String(room.id), room]));
  const activeBookings = bookingCache.filter(booking => ['checked_in', 'pending'].includes(booking.status));
  const bookingsById = new Map(bookingCache.map(booking => [String(booking.id), booking]));
  const checkedInRoomIds = new Set(activeBookings
    .filter(booking => booking.status === 'checked_in')
    .map(booking => String(booking.roomId)));
  const items = activeBookings.map(booking => ({
    kind: 'booking',
    booking,
    room: roomsById.get(String(booking.roomId)) || null,
    status: booking.status
  }));

  roomCache.forEach(room => {
    if (roomStatusInfo(room.status).className !== 'occupied' || checkedInRoomIds.has(String(room.id))) return;
    items.push({ kind: 'direct', room, status: 'checked_in' });
  });
  roomCache.forEach(room => {
    if (roomStatusInfo(room.status).className !== 'cleaning') return;
    const booking = bookingsById.get(String(room.bookingId ?? room.booking_id))
      || bookingCache.find(item => String(item.roomId) === String(room.id)
        && item.status === 'checked_out'
        && item.cleaningUntil);
    items.push({ kind: 'cleaning', room, booking, status: 'cleaning' });
  });

  const typeFilter = document.querySelector('#checkout-type-filter');
  if (typeFilter) {
    const previousValue = typeFilter.value;
    const typeNames = [...new Set([
      ...roomTypesCache.map(type => type.name),
      ...roomCache.map(room => room.roomType || room.room_type || '')
    ].filter(Boolean))];
    typeFilter.innerHTML = '<option value="">Tất cả</option>' + typeNames
      .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(roomTypeLabel(name))}</option>`).join('');
    typeFilter.value = typeNames.includes(previousValue) ? previousValue : '';
  }
  const selectedType = typeFilter?.value || '';

  const fromDate = document.querySelector('#checkout-from-date')?.value || '';
  const toDate = document.querySelector('#checkout-to-date')?.value || '';
  const query = normalize(document.querySelector('#checkout-search')?.value.trim() || '');
  const selectedStatus = document.querySelector('[data-checkout-filter].active')?.dataset.checkoutFilter || 'all';
  const getRoom = item => item.room;
  const getScheduledCheckIn = item => item.status === 'cleaning'
    ? item.booking?.actualCheckOutAt || item.room?.cleaningStartedAt
    : item.booking?.actualCheckInAt
    || item.booking?.scheduledCheckInAt
    || roomRentalField(item.room || {}, 'checkInAt', 'checked_in_at');
  const counts = {
    all: items.length,
    checked_in: items.filter(item => item.status === 'checked_in').length,
    pending: items.filter(item => item.status === 'pending').length,
    cleaning: items.filter(item => item.status === 'cleaning').length
  };
  for (const [status, count] of Object.entries(counts)) {
    const element = document.querySelector(`#checkout-count-${status.replace('_', '-')}`);
    if (element) element.textContent = count;
  }

  const filtered = items.filter(item => {
    const room = getRoom(item);
    const booking = item.booking;
    const roomType = room?.roomType || room?.room_type || '';
    const roomCode = room?.roomCode || room?.room_code || room?.roomNumber || booking?.roomCode || '';
    const scheduledCheckIn = getScheduledCheckIn(item);
    const checkInDate = String(scheduledCheckIn || '').slice(0, 10);
    const searchable = normalize([
      roomCode, roomType, booking?.customerName, booking?.customerPhone,
      booking?.customerIdentity, booking?.customerEmail
    ].join(' '));
    return (selectedStatus === 'all' || item.status === selectedStatus)
      && (!selectedType || roomType === selectedType)
      && (!query || searchable.includes(query))
      && (!fromDate || (checkInDate && checkInDate >= fromDate))
      && (!toDate || (checkInDate && checkInDate <= toDate));
  });
  const sortDirection = document.querySelector('#checkout-sort')?.value === 'oldest' ? 1 : -1;
  filtered.sort((a, b) => {
    const aTime = new Date(getScheduledCheckIn(a) || 0).getTime() || 0;
    const bTime = new Date(getScheduledCheckIn(b) || 0).getTime() || 0;
    return (aTime - bTime) * sortDirection;
  });

  const count = document.querySelector('#checkout-room-count');
  if (count) count.textContent = `Tổng: ${filtered.length} phòng`;
  if (!filtered.length) {
    roomGrid.innerHTML = `<div class="room-empty">${items.length ? 'Không tìm thấy phòng phù hợp.' : 'Hiện không có phòng đang ở hoặc đặt chờ.'}</div>`;
    return;
  }

  const dateTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  };
  const totalLabel = item => {
    const room = item.room || {};
    if (item.status === 'cleaning') return 'Dọn phòng (30 phút)';
    if (item.status === 'checked_in') {
      const bookedTotal = bookingRentalQuote(item.booking);
      if (bookedTotal !== null) return `${bookedTotal.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`;
      const current = roomRentalPrice(room);
      return current === null ? '—' : `${Number(current).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`;
    }
    const rate = Number(item.booking?.hourlyRate ?? room.hourlyRate ?? room.hourly_rate);
    const checkIn = new Date(item.booking?.scheduledCheckInAt);
    const checkOut = new Date(item.booking?.scheduledCheckOutAt);
    const estimate = Number.isFinite(rate) && checkOut > checkIn
      ? rate * Math.ceil((checkOut - checkIn) / 3600000)
      : null;
    return estimate === null ? '—' : `${estimate.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`;
  };

  roomGrid.innerHTML = filtered.map(item => {
    const room = item.room || {};
    const booking = item.booking;
    const roomCode = room.roomCode || room.room_code || room.roomNumber || booking?.roomCode || '—';
    const roomType = room.roomType || room.room_type || '';
    const imagePath = room.imagePath || room.image_path || '/assets/room-placeholder.svg';
    const isCleaning = item.status === 'cleaning';
    const customerName = booking?.customerName || (isCleaning ? 'Đã kết thúc thuê' : 'Khách thuê trực tiếp');
    const customerPhone = booking?.customerPhone || '—';
    const checkIn = booking?.actualCheckInAt || booking?.scheduledCheckInAt
      || roomRentalField(room, 'checkInAt', 'check_in_time', 'checked_in_at');
    const checkOut = booking?.scheduledCheckOutAt
      || roomRentalField(room, 'checkOutAt', 'check_out_time', 'checked_out_at');
    const isPending = item.status === 'pending';
    const statusLabel = isCleaning ? 'Đang dọn' : isPending ? 'Đang chờ' : 'Đang ở';
    const cleaningStartedAt = booking?.actualCheckOutAt || room.cleaningStartedAt;
    const cleaningUntil = booking?.cleaningUntil || room.cleaningUntil;
    const readyAt = cleaningUntil ? dateTime(cleaningUntil) : 'Sau 30 phút';
    const cleaningRemaining = cleaningUntil
      ? Math.max(0, Math.ceil((new Date(cleaningUntil).getTime() - Date.now()) / 60000))
      : null;
    const actions = booking
      ? isCleaning
        ? `<button type="button" class="checkout-card-button secondary" data-checkout-detail-booking="${escapeHtml(booking.id)}">Chi tiết</button><span class="checkout-card-button-placeholder"></span><span class="checkout-card-button-placeholder"></span>`
        : isPending
        ? `<button type="button" class="checkout-card-button secondary" data-checkout-detail-booking="${escapeHtml(booking.id)}">Chi tiết</button><button type="button" class="checkout-card-button primary" data-booking-action="check-in" data-booking-id="${escapeHtml(booking.id)}">Nhận phòng</button><button type="button" class="checkout-card-button danger" data-booking-action="cancel" data-booking-id="${escapeHtml(booking.id)}">Hủy phòng</button>`
        : `<button type="button" class="checkout-card-button secondary" data-checkout-detail-booking="${escapeHtml(booking.id)}">Chi tiết</button><button type="button" class="checkout-card-button primary" data-checkout-room-action="checkout" data-room-id="${escapeHtml(room.id)}" data-checkout-booking-id="${escapeHtml(booking.id)}">Trả phòng</button><span class="checkout-card-button-placeholder"></span>`
      : isCleaning
        ? `<button type="button" class="checkout-card-button secondary" data-checkout-detail-room="${escapeHtml(room.id)}">Chi tiết</button><span class="checkout-card-button-placeholder"></span><span class="checkout-card-button-placeholder"></span>`
        : `<button type="button" class="checkout-card-button secondary" data-checkout-detail-room="${escapeHtml(room.id)}">Chi tiết</button><button type="button" class="checkout-card-button primary" data-checkout-room-action="checkout" data-room-id="${escapeHtml(room.id)}">Trả phòng</button><span class="checkout-card-button-placeholder"></span>`;

    return `<article class="checkout-card ${isCleaning ? 'cleaning' : isPending ? 'pending' : 'occupied'}">
      <div class="checkout-card-media">
        <img src="${escapeHtml(imagePath)}" alt="Ảnh phòng ${escapeHtml(roomCode)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/room-placeholder.svg'">
        <span class="checkout-card-status"><i></i>${statusLabel}</span>
      </div>
      <div class="checkout-card-content">
        <div class="checkout-card-heading">
          <h3>${escapeHtml(roomCode)}</h3>
          <span class="checkout-card-type">${escapeHtml(roomTypeLabel(roomType))}</span>
        </div>
        <div class="checkout-card-customer">
          <span aria-hidden="true">♙</span><strong>${escapeHtml(customerName)}</strong>
          <span aria-hidden="true">▣</span><span>${escapeHtml(customerPhone)}</span>
        </div>
        <div class="checkout-card-times">
          <div><span>${isCleaning ? 'Bắt đầu dọn' : 'Check-in'}</span><strong>${escapeHtml(dateTime(isCleaning ? cleaningStartedAt : checkIn))}</strong></div>
          <div><span>${isCleaning ? 'Phòng sẵn sàng' : 'Dự kiến trả'}</span><strong>${escapeHtml(isCleaning ? readyAt : dateTime(checkOut))}</strong></div>
        </div>
        <p class="checkout-card-total"><span aria-hidden="true">▤</span>${isCleaning ? 'Nghiệp vụ:' : 'Tạm tính:'} <strong>${escapeHtml(isCleaning ? `${totalLabel(item)}${cleaningRemaining === null ? '' : ` · còn khoảng ${cleaningRemaining} phút`}` : totalLabel(item))}</strong></p>
        <div class="checkout-card-actions">${actions}</div>
      </div>
    </article>`;
  }).join('');
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
  const cleaning = roomCache.filter(room => roomStatusInfo(room.status).className === 'cleaning').length;
  document.querySelector('#checkout-nav-count').textContent = occupied;
  const usedRoomTypes = new Set(roomCache.map(room => room.roomType || room.room_type || '').filter(Boolean));
  for (const [key, value] of Object.entries({
    total: roomCache.length,
    occupied,
    available,
    cleaning,
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
      const hourlyRate = Number(room.hourlyRate ?? room.hourly_rate);
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
        : Number.isFinite(hourlyRate) && hourlyRate > 0
          ? `${hourlyRate.toLocaleString('vi-VN')}đ / giờ`
          : '';
      const statusAction = occupiedOnly || bookingViewActive
        ? status.className === 'occupied'
          ? { nextStatus: 'available', label: 'Trả phòng' }
          : status.className === 'available'
            ? { nextStatus: 'occupied', label: 'Đặt phòng' }
            : null
        : null;
      const canBookRoom = !occupiedOnly && status.className === 'available'
        && Number.isFinite(hourlyRate) && hourlyRate > 0;
      const readableStatus = status.className === 'occupied'
        ? 'Đang cho thuê'
        : status.className === 'available'
          ? 'Phòng trống'
          : status.className === 'cleaning'
            ? 'Đang dọn phòng'
            : status.label;

      return `
        <article class="room-card ${status.className}">
          <div class="room-card-media">
            <img class="room-card-image" src="${escapeHtml(imagePath)}" alt="Ảnh phòng ${escapeHtml(roomCode)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/room-placeholder.svg'">
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
            <div class="room-meta${occupiedOnly ? ' checkout-room-meta' : ''}${canBookRoom ? ' has-booking-action' : ''}">
              ${occupiedOnly ? '' : `<button type="button" class="edit-room-button" data-room-id="${escapeHtml(room.id)}" aria-label="Cập nhật phòng ${escapeHtml(roomCode)}"><span aria-hidden="true">ⓘ</span> Cập nhật</button>`}
              ${canBookRoom ? `<button type="button" class="room-booking-button" data-book-room="${escapeHtml(room.id)}">Đặt phòng</button>` : ''}
              ${statusAction ? `<button type="button" class="room-status-toggle ${status.className}" data-room-id="${escapeHtml(room.id)}" data-next-status="${statusAction.nextStatus}">${statusAction.label}</button>` : ''}
              ${occupiedOnly ? '' : `<button type="button" class="delete-room-button" data-room-id="${escapeHtml(room.id)}" aria-label="Xóa phòng ${escapeHtml(roomCode)}"><span aria-hidden="true">▤</span> Xóa</button>`}
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

  function normalizeDateTimeToMinute(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), 0, 0);
  }

  function calculateRental() {
    const checkIn = checkInInput.value ? new Date(checkInInput.value) : selectedCheckIn;
    const checkOut = new Date(checkOutInput.value);
    const normalizedNow = normalizeDateTimeToMinute(new Date());
    const normalizedCheckIn = checkIn instanceof Date && Number.isFinite(checkIn.getTime())
      ? normalizeDateTimeToMinute(checkIn)
      : null;
    const hourlyRate = Number(selectedRentalRoom?.hourlyRate ?? selectedRentalRoom?.hourly_rate);
    let message = '';

    if (!selectedRentalRoom?.id) message = 'Không tìm thấy phòng cần cho thuê.';
    else if (!(checkIn instanceof Date) || !Number.isFinite(checkIn.getTime())) message = 'Giờ vào không hợp lệ.';
    else if (normalizedCheckIn.getTime() < normalizedNow.getTime()) message = 'Thời gian nhận phòng không được ở quá khứ. Vui lòng chọn thời điểm hiện tại hoặc thời gian trong tương lai.';
    else if (!checkOutInput.value) message = 'Vui lòng chọn thời gian trả phòng.';
    else if (!Number.isFinite(checkOut.getTime())) message = 'Vui lòng chọn thời gian trả phòng hợp lệ.';
    else if (checkOut.getTime() <= checkIn.getTime()) message = 'Giờ trả phòng phải sau giờ nhận phòng.';
    else if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) message = 'Giá phòng theo giờ chưa được thiết lập.';

    selectedCheckIn = checkIn;

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
    const billableHours = Math.ceil(durationMinutes / 60);
    const total = hourlyRate * billableHours;
    rentalRoomRate.textContent = `${formatRentalCurrency(hourlyRate)}/giờ`;
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
    selectedCheckIn = null;
    checkInInput.min = localDateTimeValue(now);
    checkOutInput.min = localDateTimeValue(now);
    checkInInput.value = '';
    checkOutInput.value = '';
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
    const hourlyRate = Number(room.hourlyRate ?? room.hourly_rate);
    rentalRoomRate.textContent = Number.isFinite(hourlyRate) && hourlyRate > 0
      ? `${formatRentalCurrency(hourlyRate)}/giờ`
      : 'Chưa thiết lập giá theo giờ';
    calculateRental();
    rentRoomDialog.showModal();
  };

  checkInInput.addEventListener('input', () => {
    rentalError.textContent = '';
    showRoomFeedback('');
    if (!checkInInput.value) return;
    const checkInDate = new Date(checkInInput.value);
    if (!Number.isFinite(checkInDate.getTime())) return;
    selectedCheckIn = checkInDate;
    checkOutInput.min = localDateTimeValue(checkInDate);
    if (!checkOutInput.value || new Date(checkOutInput.value) <= checkInDate) {
      checkOutInput.value = localDateTimeValue(new Date(checkInDate.getTime() + 3600000));
    }
    calculateRental();
  });

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
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: selectedRentalRoom.id,
          checkInAt: localDateTimeValue(estimate.checkIn),
          checkOutAt: localDateTimeValue(estimate.checkOut)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể cho thuê phòng.');

      if (!result.room) throw new Error('Máy chủ không trả về thông tin phòng đã cập nhật.');
      if (result.booking) upsertBookingCache(result.booking);
      roomCache = roomCache.map(room => String(room.id) === String(result.room.id) ? result.room : room);
      renderBookingList();
      renderRoomList();
      document.dispatchEvent(new Event('rooms-updated'));
      rentRoomDialog.close();
      document.querySelector('.room-navigation [data-room-view="list"]')?.click();
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
    saveDashboardCache('room-types', roomTypesCache);
    document.dispatchEvent(new Event('room-types-updated'));
    renderRoomList();
    const roomTypeSelect = document.querySelector('#room-type-select');
    if (roomTypeSelect) {
      const selectedValue = roomTypeSelect.value;
      roomTypeSelect.innerHTML = '<option value="">-- Chọn loại phòng --</option>' + roomTypesCache
        .map((roomType) => {
          const rateLabel = roomType.hourlyRate === null
            ? ' · Chưa thiết lập giá theo giờ'
            : ` · ${Number(roomType.hourlyRate).toLocaleString('vi-VN')}đ / giờ`;
          return `<option value="${escapeHtml(roomType.name)}">${escapeHtml(roomTypeLabel(roomType.name) + rateLabel)}</option>`;
        })
        .join('');
      roomTypeSelect.value = selectedValue;
      roomTypeSelect.dispatchEvent(new Event('change'));
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
                <th>Giá theo giờ</th>
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
                const price = roomType.hourlyRate === null
                  ? 'Chưa thiết lập'
                  : `${Number(roomType.hourlyRate).toLocaleString('vi-VN')}đ / giờ`;
                return `
                  <tr data-room-type-name="${escapeHtml(roomType.name)}">
                    <td>${index + 1}</td>
                    <td>${escapeHtml(roomType.code)}</td>
                    <td><span class="room-type-pill">${escapeHtml(roomTypeLabel(roomType.name))}</span></td>
                    <td class="room-type-price">${escapeHtml(price)}</td>
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
  const hourlyRateInput = document.querySelector('#room-type-hourly-rate');
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
    hourlyRateInput.value = roomType.hourlyRate ?? '';
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
    const hourlyRate = Number(hourlyRateInput.value);
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
        body: JSON.stringify({ name, description, hourlyRate })
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
    const bookRoomButton = event.target.closest('[data-book-room]');
    if (bookRoomButton) {
      const room = roomCache.find(item => String(item.id) === bookRoomButton.dataset.bookRoom);
      if (!room || roomStatusInfo(room.status).className !== 'available') return;
      document.querySelector('.room-navigation [data-room-view="booking"]')?.click();
      const bookingRoomSelect = document.querySelector('#booking-room');
      if (bookingRoomSelect && [...bookingRoomSelect.options].some(option => option.value === String(room.id))) {
        bookingRoomSelect.value = String(room.id);
        bookingRoomSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('#booking-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const bookingDetailButton = event.target.closest('[data-checkout-detail-booking]');
    if (bookingDetailButton) {
      selectedBookingId = bookingDetailButton.dataset.checkoutDetailBooking;
      document.querySelector('.room-navigation [data-room-view="booking"]')?.click();
      return;
    }

    const directRoomDetailButton = event.target.closest('[data-checkout-detail-room]');
    if (directRoomDetailButton) {
      const room = roomCache.find(item => String(item.id) === directRoomDetailButton.dataset.checkoutDetailRoom);
      if (!room) return;
      const roomCode = room.roomCode || room.room_code || room.roomNumber || '—';
      const isCleaning = roomStatusInfo(room.status).className === 'cleaning';
      const checkIn = roomRentalField(room, 'checkInAt', 'checkInTime', 'check_in_time', 'checked_in_at');
      const checkOut = roomRentalField(room, 'checkOutAt', 'checkOutTime', 'check_out_time', 'checked_out_at');
      const total = roomRentalPrice(room);
      const detailDialog = document.querySelector('#checkout-details-dialog');
      detailDialog.querySelector('#checkout-details-title').textContent = `Phòng ${roomCode}`;
      detailDialog.querySelector('#checkout-details-content').innerHTML = `
        <dl class="checkout-detail-list">
          <div><dt>Mã phòng</dt><dd>${escapeHtml(roomCode)}</dd></div>
          <div><dt>Loại phòng</dt><dd>${escapeHtml(roomTypeLabel(room.roomType || room.room_type || ''))}</dd></div>
          <div><dt>Trạng thái</dt><dd>${isCleaning ? 'Đang dọn phòng' : 'Đang ở'}</dd></div>
          <div><dt>${isCleaning ? 'Bắt đầu dọn' : 'Giờ vào'}</dt><dd>${escapeHtml(formatBookingDateTime(isCleaning ? room.cleaningStartedAt : checkIn))}</dd></div>
          <div><dt>${isCleaning ? 'Phòng sẵn sàng' : 'Dự kiến trả'}</dt><dd>${escapeHtml(formatBookingDateTime(isCleaning ? room.cleaningUntil : checkOut))}</dd></div>
          <div><dt>${isCleaning ? 'Thời gian dọn' : 'Tạm tính'}</dt><dd>${isCleaning ? '30 phút' : total === null ? '—' : `${Number(total).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}đ`}</dd></div>
        </dl>`;
      detailDialog.showModal();
      return;
    }

    const checkoutButton = event.target.closest('[data-checkout-room-action="checkout"]');
    if (checkoutButton) {
      await returnRoom(
        checkoutButton.dataset.roomId,
        checkoutButton,
        checkoutButton.dataset.checkoutBookingId || null
      );
      return;
    }

    const checkoutBookingAction = event.target.closest('[data-booking-action]');
    if (checkoutBookingAction) {
      if (checkoutBookingAction.dataset.bookingAction === 'cancel'
        && !window.confirm('Bạn có chắc chắn muốn hủy đặt phòng này?')) return;
      await handleBookingAction(checkoutBookingAction.dataset.bookingAction, checkoutBookingAction.dataset.bookingId, checkoutBookingAction);
      return;
    }

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

document.querySelectorAll('[data-checkout-filter]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-checkout-filter]').forEach(filter => {
      const active = filter === button;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    renderCheckoutList();
  });
});
['#checkout-type-filter', '#checkout-from-date', '#checkout-to-date', '#checkout-sort']
  .forEach(selector => document.querySelector(selector)?.addEventListener('change', renderCheckoutList));
document.querySelector('#checkout-search')?.addEventListener('input', renderCheckoutList);

const checkoutDetailsDialog = document.querySelector('#checkout-details-dialog');
checkoutDetailsDialog?.querySelectorAll('[data-close-checkout-details]').forEach(button => {
  button.addEventListener('click', () => checkoutDetailsDialog.close());
});

document.querySelector('#rooms-search')?.addEventListener('input', renderRoomList);
document.querySelector('#rooms-type-filter')?.addEventListener('change', renderRoomList);
document.querySelector('#rooms-status-filter')?.addEventListener('change', renderRoomList);
document.querySelector('#booking-list')?.addEventListener('click', event => {
  const pageButton = event.target.closest('[data-booking-page]');
  if (pageButton && !pageButton.disabled) {
    bookingPage = Number(pageButton.dataset.bookingPage);
    renderBookingList();
    return;
  }
  const detailButton = event.target.closest('[data-booking-select]');
  if (detailButton) {
    selectedBookingId = detailButton.dataset.bookingSelect;
    renderBookingList();
    return;
  }
  const actionButton = event.target.closest('[data-booking-action]');
  if (!actionButton) return;
  handleBookingAction(actionButton.dataset.bookingAction, actionButton.dataset.bookingId);
});
document.querySelector('#booking-detail-card')?.addEventListener('click', event => {
  const actionButton = event.target.closest('[data-booking-action]');
  if (!actionButton) return;
  handleBookingAction(actionButton.dataset.bookingAction, actionButton.dataset.bookingId);
});
document.querySelectorAll('[data-booking-status]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-booking-status]').forEach(filter => filter.classList.toggle('active', filter === button));
    const statusSelect = document.querySelector('#booking-status-select');
    if (statusSelect) statusSelect.value = button.dataset.bookingStatus;
    bookingPage = 1;
    renderBookingList();
  });
});
document.querySelector('#booking-status-select')?.addEventListener('change', event => {
  document.querySelectorAll('[data-booking-status]').forEach(button => {
    button.classList.toggle('active', button.dataset.bookingStatus === event.target.value);
  });
  bookingPage = 1;
  renderBookingList();
});
['#booking-search', '#booking-from-date', '#booking-to-date'].forEach(selector => {
  document.querySelector(selector)?.addEventListener('input', () => {
    bookingPage = 1;
    renderBookingList();
  });
});
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
    booking: document.querySelector('#room-booking-view'),
    checkout: document.querySelector('#room-checkout-view'),
    add: document.querySelector('#room-add-view'),
    customers: document.querySelector('#customer-view'),
    types: document.querySelector('#room-types-view'),
    income: document.querySelector('#income-view'),
    profile: document.querySelector('#profile-view'),
    password: document.querySelector('#password-view'),
    settings: document.querySelector('#settings-view')
  };
  const roomError = document.querySelector('#room-error');
  const cancelButton = document.querySelector('#cancel-room-form');
  const imageInput = document.querySelector('#room-image');
  const imagePreview = document.querySelector('#image-preview');
  const descriptionInput = document.querySelector('#room-description');
  const descriptionCount = document.querySelector('.description-count');
  const roomCodeInput = document.querySelector('#room-code');
  const roomTypeSelect = document.querySelector('#room-type-select');
  const hourlyRateInput = document.querySelector('#hourly-rate');
  const hourlyRateHint = document.querySelector('#hourly-rate-hint');
  const editingStatusInput = document.querySelector('#room-status');
  const statusDefault = editingStatusInput.closest('.status-default');
  const statusHint = editingStatusInput.closest('#room-status-field').querySelector('.field-hint');
  const formHeading = document.querySelector('#room-form-heading');
  const formDescription = document.querySelector('#room-form-description');
  const formTitle = document.querySelector('#room-form-title');
  const formKicker = document.querySelector('#room-view-kicker');
  const submitLabel = document.querySelector('#room-submit-label');
  let editingRoomId = null;

  const syncNewRoomRate = () => {
    if (editingRoomId) return;
    const selectedType = roomTypesCache.find((roomType) => roomType.name === roomTypeSelect.value);
    hourlyRateInput.value = selectedType?.hourlyRate ?? '';
    hourlyRateHint.textContent = selectedType
      ? selectedType.hourlyRate === null
        ? 'Thể loại này chưa thiết lập giá theo giờ. Hãy cập nhật giá trong mục Thể loại phòng.'
        : `Giá mặc định của thể loại: ${Number(selectedType.hourlyRate).toLocaleString('vi-VN')} VNĐ / giờ.`
      : 'Chọn thể loại để tự động điền giá theo giờ.';
  };

  roomTypeSelect.addEventListener('change', syncNewRoomRate);

  const setRoomView = (viewName) => {
    Object.entries(roomViews).forEach(([name, view]) => view.classList.toggle('hidden-view', name !== viewName));
    navigationButtons.forEach((button) => button.classList.toggle('active', button.dataset.roomView === viewName));
    document.querySelectorAll('.room-navigation [data-room-view]').forEach((button) => {
      if (button.dataset.roomView === viewName) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelector('#page-title').textContent = { overview: 'Tổng quan', list: 'Phòng', booking: 'Đặt phòng', checkout: 'Trả phòng', add: 'Thông tin phòng', customers: 'Khách hàng', types: 'Thể loại phòng', income: 'Thống kê thu nhập', profile: 'Thông tin cá nhân', password: 'Đổi mật khẩu', settings: 'Cài đặt chung' }[viewName];
    if (['booking', 'checkout', 'customers'].includes(viewName)) loadBookingList();
    if (viewName === 'booking' || viewName === 'customers') loadCustomers();
    if (viewName === 'booking') updateBookingRoomOptions();
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
      setRoomView(button.dataset.roomView);
      if (['checkout', 'list'].includes(button.dataset.roomView)) renderRoomList();
    });
  });

  const clearRoomForm = () => {
    roomForm.reset();
    editingRoomId = null;
    editingStatusInput.innerHTML = '<option value="Phòng trống">Phòng trống</option><option value="Bảo trì">Bảo trì</option>';
    editingStatusInput.value = 'Phòng trống';
    editingStatusInput.disabled = true;
    statusDefault.classList.remove('is-maintenance');
    statusHint.textContent = 'Phòng mới luôn bắt đầu ở trạng thái trống.';
    hourlyRateInput.readOnly = true;
    formHeading.textContent = 'Thêm phòng';
    formDescription.textContent = 'Tạo phòng mới, nhập đầy đủ thông tin để đưa vào hệ thống.';
    formTitle.textContent = 'Thêm phòng vào hệ thống';
    formKicker.textContent = 'THÊM MỚI';
    submitLabel.textContent = 'Thêm phòng';
    resetImagePreview();
    descriptionCount.textContent = '0/240 ký tự';
    roomError.textContent = '';
    syncNewRoomRate();
  };

  openRoomForm = (room) => {
    editingRoomId = String(room.id);
    const currentStatus = room.status || 'Phòng trống';
    const canChangeStatus = ['Phòng trống', 'Bảo trì'].includes(currentStatus);
    editingStatusInput.innerHTML = '<option value="Phòng trống">Phòng trống</option><option value="Bảo trì">Bảo trì</option>';
    if (!canChangeStatus) {
      editingStatusInput.add(new Option(currentStatus, currentStatus));
    }
    editingStatusInput.value = currentStatus;
    editingStatusInput.disabled = !canChangeStatus;
    statusDefault.classList.toggle('is-maintenance', currentStatus === 'Bảo trì');
    statusHint.textContent = canChangeStatus
      ? 'Có thể chuyển phòng trống sang bảo trì hoặc mở lại phòng.'
      : 'Trạng thái phòng đang được quản lý qua quy trình đặt và trả phòng.';
    hourlyRateInput.readOnly = false;
    hourlyRateHint.textContent = 'Giá phòng này có thể chỉnh sửa riêng, không làm đổi giá mặc định của thể loại.';
    roomCodeInput.value = room.roomCode || '';
    descriptionInput.value = room.shortDescription || '';
    roomTypeSelect.value = room.roomType || '';
    hourlyRateInput.value = room.hourlyRate ?? '';
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

const globalSearch = document.querySelector('#global-search');
const globalSearchResults = document.querySelector('#global-search-results');
if (globalSearch && globalSearchResults) {
  const closeGlobalSearch = () => {
    globalSearchResults.hidden = true;
    globalSearch.setAttribute('aria-expanded', 'false');
  };
  const normalizeSearchText = value => String(value || '')
    .trim()
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
  const renderGlobalSearch = () => {
    const query = normalizeSearchText(globalSearch.value);
    if (!query) {
      closeGlobalSearch();
      globalSearchResults.innerHTML = '';
      return;
    }
    const matches = [
      ...roomCache.filter(room => normalizeSearchText([
        room.roomCode, room.room_code, room.roomNumber, room.roomType, room.room_type,
        room.shortDescription, room.short_description
      ].join(' ')).includes(query)).map(room => ({
        type: 'list',
        id: room.id,
        title: `Phòng ${room.roomCode || room.room_code || room.roomNumber || ''}`,
        detail: `${roomTypeLabel(room.roomType || room.room_type || '')} · ${room.status || 'Chưa cập nhật'}`,
        query: room.roomCode || room.room_code || room.roomNumber || ''
      })),
      ...bookingCache.filter(booking => normalizeSearchText([
        booking.id, booking.customerName, booking.customerPhone, booking.roomCode
      ].join(' ')).includes(query)).map(booking => ({
        type: 'booking',
        id: booking.id,
        title: `Đặt phòng DP${String(booking.id).padStart(3, '0')}`,
        detail: `${booking.customerName || 'Chưa có tên khách'} · ${booking.roomCode || 'Chưa chọn phòng'}`,
        query: String(booking.id)
      })),
      ...customerCache.filter(customer => normalizeSearchText([
        customer.fullName, customer.phone, customer.identityNumber, customer.email
      ].join(' ')).includes(query)).map(customer => ({
        type: 'customers',
        id: customer.id,
        title: customer.fullName || 'Khách hàng',
        detail: [customer.phone, customer.email].filter(Boolean).join(' · '),
        query: customer.fullName || customer.phone || ''
      }))
    ].slice(0, 8);
    globalSearchResults.innerHTML = matches.length
      ? matches.map(item => `<button type="button" class="global-search-result" role="option" data-search-view="${item.type}" data-search-id="${escapeHtml(item.id)}" data-search-query="${escapeHtml(item.query)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></button>`).join('')
      : '<p class="global-search-empty">Không tìm thấy kết quả phù hợp.</p>';
    globalSearchResults.hidden = false;
    globalSearch.setAttribute('aria-expanded', 'true');
  };
  const chooseGlobalSearchResult = button => {
    const view = button.dataset.searchView;
    const query = button.dataset.searchQuery || '';
    document.querySelector(`.room-navigation [data-room-view="${CSS.escape(view)}"]`)?.click();
    const target = view === 'list' ? document.querySelector('#rooms-search')
      : view === 'booking' ? document.querySelector('#booking-search')
        : document.querySelector('#customer-search');
    if (target) {
      target.value = query;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.focus();
    }
    closeGlobalSearch();
  };
  globalSearch.addEventListener('input', renderGlobalSearch);
  globalSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeGlobalSearch();
      return;
    }
    if (event.key === 'Enter' && !globalSearchResults.hidden) {
      event.preventDefault();
      const firstResult = globalSearchResults.querySelector('.global-search-result');
      if (firstResult) chooseGlobalSearchResult(firstResult);
    }
  });
  globalSearchResults.addEventListener('click', event => {
    const button = event.target.closest('.global-search-result');
    if (button) chooseGlobalSearchResult(button);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.topbar-search-wrap')) closeGlobalSearch();
  });
  document.addEventListener('dashboard-data-updated', renderGlobalSearch);
}

let rentalStatePollStarted = false;
function startRentalStatePolling() {
  if (rentalStatePollStarted) return;
  rentalStatePollStarted = true;
  window.setInterval(() => {
    refreshRentalState().catch(error => {
      showRoomFeedback(error.message || 'Không thể cập nhật tình trạng thuê phòng.', 'error');
    });
  }, 15000);
}

async function initializeDashboardData(user) {
  updateProfileForm(user);
  initializeGeneralSettings();
  const results = await Promise.allSettled([loadRoomList(), loadRoomTypes(), loadBookingList(), loadCustomers()]);
  const failedLoad = results.find(result => result.status === 'rejected');
  if (failedLoad) {
    console.error('One or more dashboard datasets failed to load.', failedLoad.reason);
  }
  checkUpcomingCheckoutWarnings();
  startRentalStatePolling();
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
    restoreDashboardCache(user.id);
    document.querySelector('#top-name').textContent = user.fullName;
    const greetingName = String(user.fullName || '').trim().split(/\s+/).at(-1);
    const greetingTitle = document.querySelector('#greeting-title');
    if (greetingTitle) greetingTitle.textContent = greetingName ? `Xin chào, ${greetingName}! 👋` : 'Xin chào! 👋';
    await initializeDashboardData(user);
  } catch (error) {
    console.error('Unable to initialize the dashboard.', error);
    window.location.href = '/login.html';
  }
}
let currentProfileUser = null;
const profileForm = document.querySelector('#profile-form');
if (profileForm) {
  const avatarInput = document.querySelector('#profile-avatar');
  const avatarPreview = document.querySelector('#profile-avatar-preview');
  const dateOfBirthInput = document.querySelector('#profile-date-of-birth');
  const emailInput = document.querySelector('#profile-email');
  const errorMessage = document.querySelector('#profile-error');
  const successMessage = document.querySelector('#profile-success');
  const saveButton = document.querySelector('#profile-save-button');
  const editButton = document.querySelector('#profile-edit-button');
  const cancelButton = document.querySelector('#profile-cancel-button');
  const today = new Date();
  dateOfBirthInput.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  function setProfileEditing(isEditing) {
    [
      '#profile-full-name',
      '#profile-username',
      '#profile-phone',
      '#profile-date-of-birth',
      '#profile-address'
    ].forEach((selector) => {
      document.querySelector(selector).readOnly = !isEditing;
    });
    emailInput.readOnly = true;
    emailInput.setAttribute('readonly', '');
    avatarInput.disabled = !isEditing;
    profileForm.querySelectorAll('.profile-gender-field input').forEach((input) => {
      input.disabled = !isEditing;
    });
    profileForm.classList.toggle('is-editing', isEditing);
    editButton.hidden = isEditing;
    cancelButton.hidden = !isEditing;
    saveButton.hidden = !isEditing;
  }

  setProfileEditing(false);
  editButton.addEventListener('click', () => {
    errorMessage.textContent = '';
    successMessage.textContent = '';
    setProfileEditing(true);
    document.querySelector('#profile-full-name').focus();
  });
  cancelButton.addEventListener('click', () => {
    if (currentProfileUser) updateProfileForm(currentProfileUser);
    avatarInput.value = '';
    errorMessage.textContent = '';
    successMessage.textContent = '';
    setProfileEditing(false);
  });

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
      setProfileEditing(false);
      successMessage.textContent = result.message || 'Cập nhật thông tin cá nhân thành công';
    } catch (error) {
      errorMessage.textContent = error.message || 'Không thể cập nhật thông tin cá nhân.';
    } finally {
      saveButton.disabled = false;
    }
  });

  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        errorMessage.textContent = 'Ảnh đại diện không được vượt quá 5MB.';
        avatarInput.value = '';
        return;
      }
      errorMessage.textContent = '';
      avatarPreview.src = URL.createObjectURL(file);
    }
  });
}

function updateProfileForm(user) {
  if (!user) return;
  currentProfileUser = user;
  const topName = document.querySelector('#top-name');
  const fullName = document.querySelector('#profile-full-name');
  const dateOfBirth = document.querySelector('#profile-date-of-birth');
  const email = document.querySelector('#profile-email');
  const phone = document.querySelector('#profile-phone');
  const address = document.querySelector('#profile-address');
  const avatarPreview = document.querySelector('#profile-avatar-preview');
  const formattedBirthDate = user.dateOfBirth
    ? user.dateOfBirth.split('-').reverse().join('/')
    : 'Chưa cập nhật';
  const summaryName = document.querySelector('#profile-summary-name');
  const summaryUsername = document.querySelector('#profile-summary-username');
  const summaryPhone = document.querySelector('#profile-summary-phone');
  const summaryEmail = document.querySelector('#profile-summary-email');
  const summaryBirthDate = document.querySelector('#profile-summary-birth-date');
  const username = document.querySelector('#profile-username');
  if (topName) topName.textContent = user.fullName || '';
  if (fullName) fullName.value = user.fullName || '';
  if (summaryName) summaryName.textContent = user.fullName || 'Tài khoản';
  if (summaryUsername) summaryUsername.textContent = user.username || 'Thành viên';
  if (summaryPhone) summaryPhone.textContent = user.phone || 'Chưa cập nhật';
  if (summaryEmail) summaryEmail.textContent = user.email || 'Chưa cập nhật';
  if (summaryBirthDate) summaryBirthDate.textContent = formattedBirthDate;
  if (username) username.value = user.username || '';
  const greetingTitle = document.querySelector('#greeting-title');
  const greetingName = String(user.fullName || '').trim().split(/\s+/).at(-1);
  if (greetingTitle) greetingTitle.textContent = greetingName ? `Xin chào, ${greetingName}! 👋` : 'Xin chào! 👋';
  if (dateOfBirth) dateOfBirth.value = user.dateOfBirth || '';
  if (email) email.value = user.email || '';
  if (phone) phone.value = user.phone || '';
  if (address) address.value = user.address || '';
  document.querySelectorAll('input[name="gender"]').forEach((input) => {
    input.checked = input.value === (user.gender || '');
  });
  const initials = (user.fullName || 'H').trim().charAt(0).toLocaleUpperCase('vi');
  const topAvatar = document.querySelector('#avatar');
  if (topAvatar) {
    topAvatar.textContent = user.avatar ? '' : initials;
    topAvatar.style.backgroundImage = user.avatar ? `url("${user.avatar}")` : '';
    topAvatar.classList.toggle('has-avatar', Boolean(user.avatar));
  }
  if (avatarPreview) avatarPreview.src = user.avatar || '/assets/sakura-mark.svg';
}

const changePasswordForm = document.querySelector('#change-password-form');
if (changePasswordForm) {
  const currentPassword = document.querySelector('#current-password');
  const newPassword = document.querySelector('#new-password');
  const confirmPassword = document.querySelector('#confirm-new-password');
  const errorMessage = document.querySelector('#change-password-error');
  const successMessage = document.querySelector('#change-password-success');
  const submitButton = document.querySelector('#change-password-submit');
  const strengthMeter = document.querySelector('#password-strength-meter');
  const strengthLabel = document.querySelector('#password-strength-label');
  const strengthRules = {
    length: document.querySelector('#password-length-rule'),
    case: document.querySelector('#password-case-rule'),
    number: document.querySelector('#password-number-rule'),
    symbol: document.querySelector('#password-symbol-rule')
  };

  changePasswordForm.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      button.setAttribute('aria-label', input.type === 'password' ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
    });
  });

  newPassword.addEventListener('input', () => {
    const value = newPassword.value;
    const checks = {
      length: value.length >= 8,
      case: /[a-z]/.test(value) && /[A-Z]/.test(value),
      number: /\d/.test(value),
      symbol: /[^A-Za-z0-9]/.test(value)
    };
    const score = Object.values(checks).filter(Boolean).length;
    for (const [rule, element] of Object.entries(strengthRules)) {
      element.classList.toggle('is-met', checks[rule]);
      element.textContent = `${checks[rule] ? '✓' : '○'} ${element.textContent.slice(2)}`;
    }
    strengthMeter.style.width = `${score * 25}%`;
    strengthMeter.dataset.strength = score < 2 ? 'weak' : score < 4 ? 'medium' : 'strong';
    strengthLabel.textContent = !value ? 'Mật khẩu nên có ít nhất 8 ký tự.' : ['Rất yếu', 'Yếu', 'Trung bình', 'Tốt', 'Mạnh'][score];
  });

  changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    successMessage.textContent = '';
    if (!changePasswordForm.checkValidity()) {
      changePasswordForm.reportValidity();
      return;
    }
    submitButton.disabled = true;
    try {
      const response = await fetch('/api/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword.value,
          newPassword: newPassword.value,
          confirmPassword: confirmPassword.value
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Không thể đổi mật khẩu.');
      changePasswordForm.reset();
      newPassword.dispatchEvent(new Event('input'));
      successMessage.textContent = result.message;
    } catch (error) {
      errorMessage.textContent = error.message || 'Không thể đổi mật khẩu.';
    } finally {
      submitButton.disabled = false;
    }
  });
}

function initializeGeneralSettings() {
  const settingsForm = document.querySelector('#general-settings-form');
  if (!settingsForm) return;
  const defaults = {
    bookingNotifications: true,
    checkoutNotifications: true,
    systemNotifications: false,
    language: 'vi',
    theme: 'light',
    idleTimeout: '30'
  };
  const settingsKey = 'hotelManagerSettings';
  let settings = defaults;
  const savedSettings = localStorage.getItem(settingsKey);
  if (savedSettings) {
    try {
      settings = { ...defaults, ...JSON.parse(savedSettings) };
    } catch (error) {
      console.error('Unable to parse saved hotel settings.', error);
      document.querySelector('#settings-message').textContent = 'Không thể đọc cài đặt đã lưu. Vui lòng lưu lại tùy chọn.';
    }
  }

  const applyTheme = (theme) => {
    const selectedTheme = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.body.dataset.theme = selectedTheme;
  };
  const applySettingsToForm = () => {
    for (const input of settingsForm.querySelectorAll('[name]')) {
      if (input.type === 'checkbox') input.checked = Boolean(settings[input.name]);
      else if (input.type === 'radio') input.checked = input.value === settings[input.name];
      else input.value = settings[input.name] ?? defaults[input.name];
    }
    applyTheme(settings.theme);
  };
  const saveSettings = (event) => {
    if (event) event.preventDefault();
    const values = Object.fromEntries(new FormData(settingsForm));
    settings = {
      bookingNotifications: settingsForm.elements.bookingNotifications.checked,
      checkoutNotifications: settingsForm.elements.checkoutNotifications.checked,
      systemNotifications: settingsForm.elements.systemNotifications.checked,
      language: values.language === 'vi' ? 'vi' : defaults.language,
      theme: ['light', 'dark', 'system'].includes(values.theme) ? values.theme : defaults.theme,
      idleTimeout: ['15', '30', '60'].includes(values.idleTimeout) ? values.idleTimeout : defaults.idleTimeout
    };
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    applyTheme(settings.theme);
    document.querySelector('#settings-message').textContent = 'Đã lưu cài đặt.';
    scheduleIdleLogout();
  };

  let idleLogoutTimer;
  const scheduleIdleLogout = () => {
    clearTimeout(idleLogoutTimer);
    idleLogoutTimer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/logout', { method: 'POST' });
        if (!response.ok) throw new Error('Không thể kết thúc phiên đăng nhập.');
        window.location.href = '/login.html';
      } catch (error) {
        const message = document.querySelector('#settings-message');
        message.textContent = error.message || 'Không thể tự động đăng xuất.';
        message.classList.add('error');
        scheduleIdleLogout();
      }
    }, Number(settings.idleTimeout) * 60 * 1000);
  };

  applySettingsToForm();
  scheduleIdleLogout();
  settingsForm.addEventListener('submit', saveSettings);
  settingsForm.addEventListener('change', (event) => {
    if (event.target.name === 'theme') applyTheme(event.target.value);
    document.querySelector('#settings-message').textContent = '';
  });
  ['pointerdown', 'keydown', 'touchstart', 'mousemove'].forEach((eventName) => {
    document.addEventListener(eventName, scheduleIdleLogout, { passive: true });
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme('system');
  });
}

loadSession();
