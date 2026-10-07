(() => {
  const overview = document.querySelector('#overview-view');
  if (!overview) return;
  const date = new Date();
  const dateLabel = document.querySelector('#dashboard-date');
  dateLabel.dateTime = date.toISOString();
  dateLabel.textContent = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  document.querySelector('#greeting').textContent =
    'Chúc bạn một ngày làm việc hiệu quả.\nCùng mang đến những trải nghiệm tuyệt vời cho khách hàng!';
  const search = document.querySelector('#overview-search');
  const statusFilter = document.querySelector('#overview-status');
  const roomMap = document.querySelector('#overview-room-map');
  const roomLayoutToggle = document.querySelector('#overview-room-layout-toggle');
  if (roomMap && roomLayoutToggle) {
    roomMap.classList.add('is-single-row');
    roomLayoutToggle.setAttribute('aria-pressed', 'true');
    roomLayoutToggle.textContent = 'Mở rộng thành nhiều hàng';
  }
  const text = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const statusOf = room => roomStatusInfo(room.status).className;
  const chartColors = ['#f26b9b', '#ffa88f', '#ffc36d', '#bd8be9', '#72c7b4', '#7aa8ed', '#f27e72'];
  let calendarDate = new Date(date.getFullYear(), date.getMonth(), 1);
  let bookingLoadState = 'loading';
  let customerLoadState = 'loading';
  const monthNames = new Intl.DateTimeFormat('vi-VN', { month: 'long' });

  function renderMap() {
    const query = normalized(search.value.trim());
    const rooms = roomCache.filter(room => (!statusFilter.value || statusOf(room) === statusFilter.value)
      && normalized((room.roomCode || '') + ' ' + (room.roomType || '')).includes(query));
    roomMap.innerHTML = rooms.length ? rooms.map(room => {
      const status = statusOf(room);
      const label = status === 'occupied' ? 'Có khách' : status === 'available' ? 'Trống' : (room.status || 'Chưa cập nhật');
      const roomCode = room.roomCode || room.room_code || room.roomNumber || '';
      const imagePath = room.imagePath || room.image_path || '/assets/room-placeholder.svg';
      const roomType = roomTypeLabel(room.roomType || room.room_type || '');
      const description = room.shortDescription || room.short_description || '';
      const hourlyRate = Number(room.hourlyRate ?? room.hourly_rate);
      const currentTotal = status === 'occupied' ? roomRentalPrice(room) : null;
      const price = status === 'occupied'
        ? currentTotal === null ? '—' : currentTotal.toLocaleString('vi-VN') + 'đ'
        : Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate.toLocaleString('vi-VN') + 'đ / giờ' : '';
      const totalAttribute = status === 'occupied' ? ' data-map-total-id="' + escapeHtml(room.id) + '"' : '';
      const checkoutAction = status === 'occupied'
        ? '<button type="button" class="map-room-checkout" data-checkout-room="' + escapeHtml(room.id) + '">Trả phòng</button>'
        : '';
      return '<article class="map-room ' + status + '"><button type="button" class="map-room-open" data-map-room="' + escapeHtml(room.id) + '" aria-label="Cập nhật phòng ' + escapeHtml(roomCode) + ' — ' + escapeHtml(label) + '"><span class="map-room-media"><img src="' + escapeHtml(imagePath) + '" alt="Ảnh phòng ' + escapeHtml(roomCode) + '" onerror="this.onerror=null;this.src=\'/assets/room-placeholder.svg\'"><span class="map-room-status"><i></i>' + escapeHtml(label) + '</span></span><span class="map-room-details"><strong>' + escapeHtml(roomCode) + '</strong><span class="map-room-type">' + escapeHtml(roomType) + '</span><span class="map-room-description">' + escapeHtml(description) + '</span><span class="map-room-price"' + totalAttribute + '>' + escapeHtml(price) + '</span></span></button>' + checkoutAction + '</article>';
    }).join('') : '<p class="map-empty">Không có phòng phù hợp.</p>';
  }

  function renderTypes() {
    const names = [...new Set([...roomTypesCache.map(type => type.name), ...roomCache.map(room => room.roomType || 'Chưa phân loại')])];
    const legend = document.querySelector('#room-type-legend');
    const chart = document.querySelector('#room-type-chart');
    if (!legend || !chart) return;
    const values = names.map(name => ({
      name,
      count: roomCache.filter(room => (room.roomType || 'Chưa phân loại') === name).length
    })).filter(item => item.count > 0);
    const total = values.reduce((sum, item) => sum + item.count, 0);
    text('room-type-chart-total', total || '—');
    legend.innerHTML = values.length ? values.map((item, index) => (
      '<li><i style="--legend-color:' + chartColors[index % chartColors.length] + '"></i><span>' +
      escapeHtml(roomTypeLabel(item.name)) + '</span><strong>' + item.count + '</strong></li>'
    )).join('') : '<li class="overview-empty">Chưa có dữ liệu thể loại.</li>';
    let offset = 0;
    const segments = values.map((item, index) => {
      const start = offset / total * 100;
      offset += item.count;
      return chartColors[index % chartColors.length] + ' ' + start + '% ' + offset / total * 100 + '%';
    });
    chart.style.background = total ? 'conic-gradient(' + segments.join(', ') + ')' : '#f2e8ed';
    chart.setAttribute('aria-label', values.map(item => item.name + ': ' + item.count).join(', ') || 'Chưa có dữ liệu thể loại');
  }

  function renderRevenue() {
    const chart = document.querySelector('#revenue-chart');
    const yearSelect = document.querySelector('#revenue-year');
    if (!chart || !yearSelect) return;
    const years = new Set([date.getFullYear()]);
    bookingCache.forEach(booking => {
      const value = booking.actualCheckOutAt;
      if (value) {
        const year = new Date(value).getFullYear();
        if (Number.isFinite(year)) years.add(year);
      }
    });
    const selectedYear = Number(yearSelect.value) || date.getFullYear();
    yearSelect.innerHTML = [...years].sort((a, b) => b - a).map(year =>
      '<option value="' + year + '">' + year + '</option>'
    ).join('');
    yearSelect.value = String(selectedYear);
    const totals = Array(12).fill(0);
    bookingCache.forEach(booking => {
      if (booking.status !== 'checked_out' || booking.rentalTotal == null || !booking.actualCheckOutAt) return;
      const closedAt = new Date(booking.actualCheckOutAt);
      if (closedAt.getFullYear() === selectedYear) totals[closedAt.getMonth()] += Number(booking.rentalTotal) || 0;
    });
    const max = Math.max(...totals, 1);
    chart.innerHTML = totals.map((amount, index) => {
      const height = amount > 0 ? Math.max(5, Math.round(amount / max * 100)) : 2;
      const label = new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
      return '<div class="revenue-month" title="' + (index + 1) + '/' + selectedYear + ': ' + label + '">' +
        '<span class="revenue-value">' + (amount ? escapeHtml(label) : '') + '</span>' +
        '<i style="--bar-height:' + height + '%"></i><span class="revenue-month-label">T' + (index + 1) + '</span></div>';
    }).join('');
    chart.setAttribute('aria-label', 'Doanh thu năm ' + selectedYear + ': ' + new Intl.NumberFormat('vi-VN').format(totals.reduce((sum, amount) => sum + amount, 0)) + ' đồng');
  }

  function renderRecentLists() {
    const statusLabels = { pending: 'Đang chờ', checked_in: 'Đang ở', checked_out: 'Đã trả', cancelled: 'Đã hủy' };
    const latestBookings = [...bookingCache].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 5);
    const bookingRows = document.querySelector('#overview-bookings');
    if (bookingRows) {
      bookingRows.innerHTML = latestBookings.length ? latestBookings.map((booking, index) => (
        '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(booking.customerName || '—') + '</td><td>' +
        escapeHtml(booking.roomCode || roomCache.find(room => String(room.id) === String(booking.roomId))?.roomCode || '—') +
        '</td><td>' + escapeHtml(formatBookingDate(booking.scheduledCheckInAt)) + '</td><td>' +
        escapeHtml(formatBookingDate(booking.scheduledCheckOutAt)) + '</td><td><span class="overview-status ' +
        escapeHtml(booking.status || 'pending') + '">' + escapeHtml(statusLabels[booking.status] || 'Chưa rõ') + '</span></td></tr>'
      )).join('') : '<tr><td colspan="6" class="overview-empty">' +
        escapeHtml(bookingLoadState || 'Chưa có đặt phòng.') + '</td></tr>';
    }
    const customerRows = document.querySelector('#overview-customers');
    if (customerRows) {
      const latestCustomers = [...customerCache].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 5);
      customerRows.innerHTML = latestCustomers.length ? latestCustomers.map((customer, index) => (
        '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(customer.fullName || '—') + '</td><td>' +
        escapeHtml(customer.phone || '—') + '</td><td>' + escapeHtml(customer.email || '—') + '</td></tr>'
      )).join('') : '<tr><td colspan="4" class="overview-empty">' +
        escapeHtml(customerLoadState || 'Chưa có khách hàng.') + '</td></tr>';
    }
  }

  function renderCalendar() {
    const grid = document.querySelector('#calendar-days');
    const monthLabel = document.querySelector('#calendar-month');
    if (!grid || !monthLabel) return;
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    monthLabel.textContent = monthNames.format(calendarDate) + ' ' + year;
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const cells = Array(firstWeekday).fill('<span class="calendar-day outside"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayKey = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const bookings = bookingCache.filter(booking => booking.status !== 'cancelled'
        && String(booking.scheduledCheckInAt || '').slice(0, 10) === dayKey);
      const markers = [...new Set(bookings.map(booking => booking.status))].map(status =>
        '<i class="calendar-dot ' + (status === 'checked_in' ? 'checked-in' : status === 'checked_out' ? 'checked-out' : 'pending') + '"></i>'
      ).join('');
      const todayClass = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day ? ' today' : '';
      const title = bookings.length ? bookings.length + ' đặt phòng nhận ngày ' + day : '';
      cells.push('<span class="calendar-day' + todayClass + '" title="' + escapeHtml(title) + '">' + day + '<span>' + markers + '</span></span>');
    }
    while (cells.length < 42) cells.push('<span class="calendar-day outside"></span>');
    grid.innerHTML = cells.join('');
  }

  function renderDashboardDetails() {
    renderRevenue();
    renderRecentLists();
    renderCalendar();
  }

  document.querySelector('#calendar-previous')?.addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.querySelector('#calendar-next')?.addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  document.querySelector('#revenue-year')?.addEventListener('change', renderRevenue);
  document.addEventListener('dashboard-data-updated', renderDashboardDetails);
  document.addEventListener('dashboard-bookings-error', event => {
    bookingLoadState = event.detail || 'Không tải được đặt phòng.';
    renderRecentLists();
  });
  document.addEventListener('dashboard-customers-error', event => {
    customerLoadState = event.detail || 'Không tải được khách hàng.';
    renderRecentLists();
  });
  document.addEventListener('dashboard-bookings-loaded', () => { bookingLoadState = ''; });
  document.addEventListener('dashboard-customers-loaded', () => { customerLoadState = ''; });

  function renderOverview() {
    text('overview-error', '');
    const total = roomCache.length;
    const occupied = roomCache.filter(room => statusOf(room) === 'occupied').length;
    const available = roomCache.filter(room => statusOf(room) === 'available').length;
    const other = total - occupied - available;
    for (const [key, value] of Object.entries({total, occupied, available, other})) {
      text('stat-' + key, value);
      text('legend-' + key, value);
    }
    const percent = total ? Math.round(occupied / total * 100) : 0;
    text('occupancy-percent', percent + '%');
    const chart = document.querySelector('#occupancy-chart');
    chart.style.background = total ? 'conic-gradient(#d9507b 0 ' + occupied / total * 100 + '%, #f9c8d5 0 ' + (occupied + available) / total * 100 + '%, #d8d4dc 0)' : '#eee8ec';
    chart.setAttribute('aria-label', occupied + ' trên ' + total + ' phòng đang sử dụng, ' + percent + '%');
    renderMap();
    renderTypes();
    renderDashboardDetails();
  }

  document.addEventListener('rooms-updated', renderOverview);
  document.addEventListener('room-types-updated', () => { if (!document.querySelector('#overview-error').textContent) renderTypes(); });
  document.addEventListener('rooms-error', event => {
    if (roomCache.length) return;
    text('overview-error', event.detail);
    for (const key of ['total', 'occupied', 'available', 'other']) text('stat-' + key, '—');
    text('occupancy-percent', '—');
    document.querySelector('#occupancy-chart').style.background = '#eee8ec';
    document.querySelector('#occupancy-chart').setAttribute('aria-label', 'Không tải được dữ liệu');
    text('overview-room-map', 'Không tải được danh sách phòng. Vui lòng tải lại trang.');
  });
  search.addEventListener('input', renderMap);
  statusFilter.addEventListener('change', renderMap);
  roomLayoutToggle?.addEventListener('click', () => {
    const singleRow = roomMap.classList.toggle('is-single-row');
    roomLayoutToggle.setAttribute('aria-pressed', String(singleRow));
    roomLayoutToggle.textContent = singleRow ? 'Mở rộng thành nhiều hàng' : 'Xếp thành một hàng';
  });
  roomMap.addEventListener('click', event => {
    const button = event.target.closest('[data-map-room]');
    if (!button) return;
    const room = roomCache.find(room => String(room.id) === button.dataset.mapRoom);
    if (room && openRoomForm) openRoomForm(room);
  });
  [
    ['stat-occupied', 'occupied'],
    ['stat-available', 'available'],
    ['stat-other', 'maintenance']
  ].forEach(([id, status]) => {
    const stat = document.getElementById(id);
    if (!stat) return;
    stat.setAttribute('role', 'button');
    stat.setAttribute('tabindex', '0');
    stat.setAttribute('aria-label', `Lọc phòng: ${stat.querySelector('h3')?.textContent || 'trạng thái'}`);
    stat.addEventListener('click', () => {
      statusFilter.value = status;
      renderMap();
    });
    stat.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      stat.click();
    });
  });
  const totalStat = document.querySelector('#stat-total')?.closest('.stat-card');
  if (totalStat) {
    totalStat.setAttribute('role', 'button');
    totalStat.setAttribute('tabindex', '0');
    totalStat.setAttribute('aria-label', 'Mở danh sách tất cả phòng');
    const openRoomList = () => document.querySelector('.room-navigation [data-room-view="list"]')?.click();
    totalStat.addEventListener('click', openRoomList);
    totalStat.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openRoomList();
    });
  }
})();
