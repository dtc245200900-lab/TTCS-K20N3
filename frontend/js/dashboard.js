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
  let selectedRevenueMonth = null;
  let selectedRevenueDay = null;
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
      return '<article class="map-room ' + status + '"><button type="button" class="map-room-open" data-map-room="' + escapeHtml(room.id) + '" aria-label="Cập nhật phòng ' + escapeHtml(roomCode) + ' — ' + escapeHtml(label) + '"><span class="map-room-media"><img src="' + escapeHtml(imagePath) + '" alt="Ảnh phòng ' + escapeHtml(roomCode) + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'/assets/room-placeholder.svg\'"><span class="map-room-status"><i></i>' + escapeHtml(label) + '</span></span><span class="map-room-details"><strong>' + escapeHtml(roomCode) + '</strong><span class="map-room-type">' + escapeHtml(roomType) + '</span><span class="map-room-description">' + escapeHtml(description) + '</span><span class="map-room-price"' + totalAttribute + '>' + escapeHtml(price) + '</span></span></button>' + checkoutAction + '</article>';
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

  function getMonthlyIncomeForYear(year) {
    const totals = Array(12).fill(0);
    bookingCache.forEach(booking => {
      if (booking.status !== 'checked_out' || booking.rentalTotal == null || !booking.actualCheckOutAt) return;
      const closedAt = new Date(booking.actualCheckOutAt);
      if (closedAt.getFullYear() !== year) return;
      totals[closedAt.getMonth()] += Number(booking.rentalTotal) || 0;
    });
    return totals;
  }

  function renderRevenueDailyDetail(containerId, year) {
    const container = document.querySelector('#' + containerId);
    if (!container) return;
    if (!selectedRevenueMonth || selectedRevenueMonth.year !== year) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    const { month } = selectedRevenueMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, () => ({
      bookings: new Map(),
      total: 0
    }));
    const formatCurrency = amount => Number(amount).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';
    const roomInfoFor = booking => {
      const room = roomCache.find(item => String(item.id) === String(booking.roomId));
      return {
        key: String(booking.roomId || booking.roomCode || room?.roomCode || 'unknown'),
        code: booking.roomCode || room?.roomCode || room?.room_code || 'Chưa rõ phòng',
        type: roomTypeLabel(room?.roomType || room?.room_type || booking.roomType || 'Chưa phân loại')
      };
    };
    const addBookingEvent = (day, booking, label, revenue = 0) => {
      const key = String(booking.id || booking.roomId || booking.roomCode);
      let entry = day.bookings.get(key);
      if (!entry) {
        entry = { booking, labels: new Set(), revenue: 0, room: roomInfoFor(booking) };
        day.bookings.set(key, entry);
      }
      entry.labels.add(label);
      entry.revenue += revenue;
    };

    bookingCache.forEach(booking => {
      if (booking.status === 'cancelled') return;
      const addDateEvent = (value, label, revenue = 0) => {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match || Number(match[1]) !== year || Number(match[2]) !== month + 1) return;
        const dayNumber = Number(match[3]);
        if (dayNumber < 1 || dayNumber > daysInMonth) return;
        const day = days[dayNumber - 1];
        addBookingEvent(day, booking, label, revenue);
        day.total += revenue;
      };
      addDateEvent(booking.scheduledCheckInAt, 'Nhận phòng');
      addDateEvent(booking.scheduledCheckOutAt, 'Ngày trả dự kiến');
      if (booking.actualCheckOutAt) {
        const revenue = booking.status === 'checked_out' ? Number(booking.rentalTotal) || 0 : 0;
        addDateEvent(booking.actualCheckOutAt, 'Đã trả phòng', revenue);
      }
    });

    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = Array(firstWeekday).fill('<span class="revenue-calendar-empty" aria-hidden="true"></span>');
    for (let index = 0; index < daysInMonth; index += 1) {
      const dayNumber = index + 1;
      const hasData = days[index].bookings.size > 0;
      const selected = selectedRevenueDay?.year === year
        && selectedRevenueDay.month === month
        && selectedRevenueDay.day === dayNumber;
      const title = hasData
        ? dayNumber + ' tháng ' + (month + 1) + ': ' + days[index].bookings.size + ' lượt đặt/trả phòng'
        : dayNumber + ' tháng ' + (month + 1) + ': Chưa có dữ liệu';
      cells.push('<button type="button" class="revenue-calendar-day' + (hasData ? ' has-data' : '') +
        '" data-revenue-day="' + dayNumber + '" data-revenue-month="' + month + '" data-revenue-year="' + year +
        '" aria-pressed="' + selected + '" aria-label="' + escapeHtml(title) + '"><span>' + dayNumber +
        '</span><i aria-hidden="true"></i></button>');
    }
    while (cells.length % 7) cells.push('<span class="revenue-calendar-empty" aria-hidden="true"></span>');

    const monthLabel = new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' })
      .format(new Date(year, month, 1));
    container.hidden = false;
    container.innerHTML = '<h4>Chi tiết ' + escapeHtml(monthLabel) + '</h4>' +
      '<div class="revenue-calendar-weekdays" aria-hidden="true"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>' +
      '<div class="revenue-calendar-grid" role="group" aria-label="Lịch ' + escapeHtml(monthLabel) + '">' + cells.join('') + '</div>' +
      '<p class="revenue-daily-note"><i class="revenue-calendar-dot has-data"></i>Có dữ liệu đặt/trả phòng <i class="revenue-calendar-dot"></i>Chưa có dữ liệu</p>' +
      '<section class="revenue-selected-day" aria-live="polite">' + renderSelectedRevenueDay(days, year, month, formatCurrency) + '</section>';
  }

  function renderSelectedRevenueDay(days, year, month, formatCurrency) {
    const selected = selectedRevenueDay;
    if (!selected || selected.year !== year || selected.month !== month) {
      return '<p class="revenue-day-placeholder">Chọn một ngày trên lịch để xem chi tiết đặt phòng và doanh thu.</p>';
    }

    const day = days[selected.day - 1];
    const dateLabel = new Intl.DateTimeFormat('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date(year, month, selected.day));
    const rows = [...day.bookings.values()];
    const bookingRows = rows.map(({ booking, labels, revenue, room }) => {
      const statusLabels = {
        pending: 'Đang chờ',
        checked_in: 'Đang ở',
        checked_out: 'Đã trả',
        cancelled: 'Đã hủy'
      };
      return '<article class="revenue-booking-detail"><header><span><strong>' + escapeHtml(room.code) +
        '</strong><small>' + escapeHtml(room.type) + '</small></span><span class="revenue-booking-status">' +
        escapeHtml(statusLabels[booking.status] || 'Chưa rõ') + '</span></header><p>' +
        escapeHtml([...labels].join(' · ')) + ' · Khách: ' + escapeHtml(booking.customerName || '—') +
        '</p><p>Thời gian: ' + escapeHtml(formatBookingDateTime(booking.scheduledCheckInAt)) +
        ' – ' + escapeHtml(formatBookingDateTime(booking.scheduledCheckOutAt)) + '</p>' +
        (revenue > 0 ? '<strong class="revenue-booking-amount">Doanh thu phòng: ' +
          formatCurrency(revenue) + '</strong>' : '') + '</article>';
    }).join('');
    return '<div class="revenue-selected-day-heading"><h5>' + escapeHtml(dateLabel) +
      '</h5><strong>Tổng doanh thu ngày: ' + formatCurrency(day.total) +
      '</strong></div><p class="revenue-selected-day-summary">' + rows.length +
      ' lượt đặt/trả phòng · ' + formatCurrency(day.total) + ' doanh thu</p>' +
      (bookingRows || '<p class="revenue-day-placeholder">Ngày này chưa có dữ liệu đặt hoặc trả phòng.</p>');
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
    const totals = getMonthlyIncomeForYear(selectedYear);
    const max = Math.max(...totals, 1);
    chart.innerHTML = totals.map((amount, index) => {
      const height = amount > 0 ? Math.max(5, Math.round(amount / max * 100)) : 2;
      const label = new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
      const selected = selectedRevenueMonth?.year === selectedYear && selectedRevenueMonth.month === index;
      return '<button type="button" class="revenue-month" data-revenue-select-month="' + index + '" data-revenue-year="' + selectedYear +
        '" aria-pressed="' + selected + '" title="' + (index + 1) + '/' + selectedYear + ': ' + label + '">' +
        '<span class="revenue-value">' + (amount ? escapeHtml(label) : '') + '</span>' +
        '<i style="--bar-height:' + height + '%"></i><span class="revenue-month-label">T' + (index + 1) + '</span></button>';
    }).join('');
    chart.setAttribute('aria-label', 'Doanh thu năm ' + selectedYear + ': ' + new Intl.NumberFormat('vi-VN').format(totals.reduce((sum, amount) => sum + amount, 0)) + ' đồng');
    renderRevenueDailyDetail('revenue-daily-detail', selectedYear);
  }

  function renderIncomeReport() {
    const body = document.querySelector('#income-table-body');
    const yearLabel = document.querySelector('#income-year-label');
    const totalCell = document.querySelector('#income-year-total');
    const totalFooterCell = document.querySelector('#income-year-total-footer');
    const roomTotalCell = document.querySelector('#income-room-total');
    const roomTotalFooterCell = document.querySelector('#income-room-total-footer');
    const serviceTotalCell = document.querySelector('#income-service-total');
    const bookingCountCell = document.querySelector('#income-booking-count');
    const yearSelect = document.querySelector('#income-year-select');
    if (!body) return;

    const currentYear = new Date().getFullYear();
    const years = new Set([currentYear, currentYear - 1, currentYear + 1, currentYear - 2, currentYear + 2]);
    bookingCache.forEach(booking => {
      const actualDate = booking.actualCheckOutAt ? new Date(booking.actualCheckOutAt) : null;
      if (actualDate && Number.isFinite(actualDate.getTime())) {
        years.add(actualDate.getFullYear());
      }
    });

    const orderedYears = [...years].sort((a, b) => b - a);
    const currentSelected = Number(yearSelect?.value || currentYear);
    const selectedYear = orderedYears.includes(currentSelected) ? currentSelected : currentYear;

    if (yearSelect) {
      yearSelect.innerHTML = orderedYears.map(year =>
        '<option value="' + year + '">' + year + '</option>'
      ).join('');
      yearSelect.value = String(selectedYear);
    }
    const totals = getMonthlyIncomeForYear(selectedYear);
    const totalYear = totals.reduce((sum, amount) => sum + amount, 0);
    const previousYearTotals = getMonthlyIncomeForYear(selectedYear - 1);
    const completedBookings = bookingCache.filter(booking => {
      if (booking.status !== 'checked_out' || !booking.actualCheckOutAt) return false;
      const actualDate = new Date(booking.actualCheckOutAt);
      return Number.isFinite(actualDate.getTime()) && actualDate.getFullYear() === selectedYear;
    }).length;
    const formatCurrency = amount => Number(amount).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';

    body.innerHTML = totals.map((amount, index) => {
      const previousAmount = previousYearTotals[index];
      const change = previousAmount > 0
        ? Math.round((amount - previousAmount) / previousAmount * 100)
        : amount > 0 ? null : 0;
      const changeClass = change === null || change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
      const changeLabel = change === null ? 'Mới' : change > 0 ? '↑ ' + change + '%' : change < 0 ? '↓ ' + Math.abs(change) + '%' : '—';
      return '<tr><td>Tháng ' + (index + 1) + '</td><td>' + formatCurrency(amount) +
        '</td><td>0đ</td><td>' + formatCurrency(amount) +
        '</td><td><span class="income-change ' + changeClass + '">' + changeLabel + '</span></td></tr>';
    }).join('');

    if (yearLabel) yearLabel.textContent = String(selectedYear);
    if (totalCell) totalCell.textContent = formatCurrency(totalYear);
    if (totalFooterCell) totalFooterCell.textContent = formatCurrency(totalYear);
    if (roomTotalCell) roomTotalCell.textContent = formatCurrency(totalYear);
    if (roomTotalFooterCell) roomTotalFooterCell.textContent = formatCurrency(totalYear);
    if (serviceTotalCell) serviceTotalCell.textContent = '0đ';
    if (bookingCountCell) bookingCountCell.textContent = String(completedBookings);

    const chart = document.querySelector('#income-monthly-chart');
    if (chart) {
      const maxAmount = Math.max(...totals, 1);
      chart.innerHTML = totals.map((amount, index) => {
        const barHeight = amount > 0 ? Math.max(1, amount / maxAmount * 100) : 0;
        const selected = selectedRevenueMonth?.year === selectedYear && selectedRevenueMonth.month === index;
        return '<button type="button" class="income-chart-month" data-revenue-select-month="' + index + '" data-revenue-year="' + selectedYear +
          '" aria-pressed="' + selected + '" title="Tháng ' + (index + 1) + ': ' + formatCurrency(amount) + '">' +
          '<div class="income-chart-bars"><i class="room-revenue" style="--bar-height:' + barHeight + '%"></i>' +
          '<i class="service-revenue" style="--bar-height:0%"></i></div>' +
          '<span>Th' + (index + 1) + '</span></button>';
      }).join('');
      chart.setAttribute('aria-label', 'Biểu đồ doanh thu phòng năm ' + selectedYear + ': ' + formatCurrency(totalYear) + '. Chưa có dữ liệu doanh thu dịch vụ.');
    }
    renderRevenueDailyDetail('income-daily-detail', selectedYear);

    const table = document.querySelector('#income-view .income-report-table');
    if (table) table.setAttribute('aria-label', 'Thống kê thu nhập năm ' + selectedYear + ': ' + formatCurrency(totalYear));
  }

  document.querySelector('#income-prev-year')?.addEventListener('click', () => {
    const yearSelect = document.querySelector('#income-year-select');
    if (!yearSelect) return;
    const currentSelected = Number(yearSelect.value) || new Date().getFullYear();
    const nextVal = currentSelected - 1;
    yearSelect.value = String(nextVal);
    renderIncomeReport();
  });

  document.querySelector('#income-next-year')?.addEventListener('click', () => {
    const yearSelect = document.querySelector('#income-year-select');
    if (!yearSelect) return;
    const currentSelected = Number(yearSelect.value) || new Date().getFullYear();
    const nextVal = currentSelected + 1;
    yearSelect.value = String(nextVal);
    renderIncomeReport();
  });

  document.querySelector('#income-year-select')?.addEventListener('change', renderIncomeReport);
  for (const detailHost of ['.revenue-card', '#income-view .income-chart-panel']) {
    document.querySelector(detailHost)?.addEventListener('click', event => {
      const dayButton = event.target.closest('button[data-revenue-day]');
      if (dayButton) {
        selectedRevenueDay = {
          year: Number(dayButton.dataset.revenueYear),
          month: Number(dayButton.dataset.revenueMonth),
          day: Number(dayButton.dataset.revenueDay)
        };
      } else {
        const monthButton = event.target.closest('button[data-revenue-select-month]');
        if (!monthButton) return;
        selectedRevenueMonth = {
          year: Number(monthButton.dataset.revenueYear),
          month: Number(monthButton.dataset.revenueSelectMonth)
        };
        selectedRevenueDay = null;
      }
      renderRevenue();
      renderIncomeReport();
    });
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
    renderIncomeReport();
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
  const exportPdfButton = document.querySelector('#income-export-pdf');


if (exportPdfButton) {
    exportPdfButton.addEventListener('click', () => {
        const year = document.querySelector('#income-year-select')?.value || '2026';
        const report = document.querySelector('#income-view');

        if (!report) {
            alert('Không tìm thấy báo cáo thu nhập!');
            return;
        }

        const printWindow = window.open('', '_blank');

        if (!printWindow) {
            alert('Vui lòng cho phép mở cửa sổ để xuất PDF!');
            return;
        }

        const styles = `
    <link rel="stylesheet" href="/css/dashboard.css">
`;
        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <base href="${document.baseURI}">
                <title>Thong_ke_thu_nhap_${year}</title>
                ${styles}
                
<style>
    @page {
        size: A4 landscape;
        margin: 10mm;
    }
#income-monthly-chart {
    display: flex !important;
    align-items: flex-end !important;
    min-height: 200px !important;
}

.income-chart-month {
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-end !important;
    flex: 1 !important;
}

.income-chart-bars {
    display: flex !important;
    align-items: flex-end !important;
    height: 180px !important;
}

.income-chart-bars .room-revenue {
    height: var(--bar-height, 0%) !important;
    background: #df3476 !important;
    min-width: 12px !important;
}

@media print {
    * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
}
    * {
        box-sizing: border-box;
    }

    body {
        margin: 0;
        padding: 10px;
        background: white !important;
        font-family: Arial, sans-serif;
    }

    #income-view {
        display: block !important;
        visibility: visible !important;
        width: 100% !important;
        max-width: 100% !important;
        padding: 0 !important;
    }

    #income-view svg {
        width: 20px !important;
        height: 20px !important;
        max-width: 20px !important;
        max-height: 20px !important;
    }

    #income-view .income-report-actions,
    #income-export-pdf {
        display: none !important;
    }

    #income-view table {
        width: 100% !important;
        border-collapse: collapse;
        font-size: 11px;
    }

    #income-view canvas {
        max-width: 100% !important;
    }

    .income-report-summary,
    .income-summary-card,
    table,
    tr {
        break-inside: avoid;
    }
</style>

</head>
<body class="dashboard-page">
    ${report.outerHTML.replace(/(<select[^>]*id="income-year-select"[^>]*>)[\s\S]*?(<\/select>)/, '$1<option selected value="' + year + '">' + year + '</option>$2')}
</body>
</html>
`);

printWindow.document.close();

printWindow.onload = async () => {
    await printWindow.document.fonts.ready;

    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 1000);
};
});
}
})();
