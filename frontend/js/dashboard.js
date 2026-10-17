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
      return '<div class="revenue-month" title="' + (index + 1) + '/' + selectedYear + ': ' + label + '">' +
        '<span class="revenue-value">' + (amount ? escapeHtml(label) : '') + '</span>' +
        '<i style="--bar-height:' + height + '%"></i><span class="revenue-month-label">T' + (index + 1) + '</span></div>';
    }).join('');
    chart.setAttribute('aria-label', 'Doanh thu năm ' + selectedYear + ': ' + new Intl.NumberFormat('vi-VN').format(totals.reduce((sum, amount) => sum + amount, 0)) + ' đồng');
  }

  function renderIncomeReport() {
    const body = document.querySelector('#income-table-body');
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
    const previousYearTotal = previousYearTotals.reduce((sum, amount) => sum + amount, 0);
    const completedBookings = bookingCache.filter(booking => {
      if (booking.status !== 'checked_out' || !booking.actualCheckOutAt) return false;
      const actualDate = new Date(booking.actualCheckOutAt);
      return Number.isFinite(actualDate.getTime()) && actualDate.getFullYear() === selectedYear;
    }).length;
    const formatCurrency = amount => Number(amount).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';
    const formatChange = (amount, previousAmount) => previousAmount > 0
      ? (amount >= previousAmount ? '↑ ' : '↓ ') + Math.round(Math.abs(amount - previousAmount) / previousAmount * 100) + '%'
      : amount > 0 ? 'Mới' : '—';
    const yearChange = document.querySelector('#income-year-change');
    const yearChangeFooter = document.querySelector('#income-year-change-footer');
    const periodLabel = document.querySelector('#income-period-label');
    const topRoomsPeriod = document.querySelector('#income-top-rooms-period');
    if (periodLabel) periodLabel.textContent = '01/01/' + selectedYear + ' - 31/12/' + selectedYear;
    if (topRoomsPeriod) topRoomsPeriod.textContent = String(selectedYear);
    if (yearChange) {
      yearChange.textContent = formatChange(totalYear, previousYearTotal);
      yearChange.className = totalYear >= previousYearTotal ? 'positive' : 'negative';
    }
    if (yearChangeFooter) yearChangeFooter.textContent = formatChange(totalYear, previousYearTotal);

    body.innerHTML = totals.map((amount, index) => {
      const previousAmount = index === 0 ? 0 : totals[index - 1];
      const changeClass = index === 0 ? 'neutral' : amount >= previousAmount ? 'positive' : 'negative';
      const changeLabel = index === 0 ? '—' : formatChange(amount, previousAmount);
      return '<tr><td>Tháng ' + (index + 1) + '</td><td>' + formatCurrency(amount) +
        '</td><td>0đ</td><td>' + formatCurrency(amount) +
        '</td><td><span class="income-change ' + changeClass + '">' + changeLabel + '</span></td></tr>';
    }).join('');

    if (totalCell) totalCell.textContent = formatCurrency(totalYear);
    if (totalFooterCell) totalFooterCell.textContent = formatCurrency(totalYear);
    if (roomTotalCell) roomTotalCell.textContent = formatCurrency(totalYear);
    if (roomTotalFooterCell) roomTotalFooterCell.textContent = formatCurrency(totalYear);
    if (serviceTotalCell) serviceTotalCell.textContent = '0đ';
    if (bookingCountCell) bookingCountCell.textContent = String(completedBookings);

    const maxChartAmount = Math.max(...totals, 1);
    const chart = document.querySelector('#income-monthly-chart');
    if (chart) {
      const points = totals.map((amount, index) => {
        const x = (index + 0.5) / totals.length * 1200;
        const y = 145 - (amount / maxChartAmount) * 116;
        return x.toFixed(1) + ',' + y.toFixed(1);
      });
      chart.innerHTML = totals.map((amount, index) => {
        const barHeight = amount > 0 ? Math.max(1, amount / maxChartAmount * 100) : 0;
          const selected = selectedRevenueMonth?.year === selectedYear && selectedRevenueMonth.month === index;
          return '<button type="button" class="income-chart-month" data-revenue-select-month="' + index + '" data-revenue-year="' + selectedYear +
            '" aria-pressed="' + selected + '" title="Tháng ' + (index + 1) + ': ' + formatCurrency(amount) + '">' +
            '<div class="income-chart-bars"><i class="room-revenue" style="--bar-height:' + barHeight + '%"></i>' +
            '<i class="service-revenue" style="--bar-height:0%"></i></div>' +
            '<span>Th' + (index + 1) + '</span></button>';
      }).join('') + '<svg class="income-chart-total-line" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true"><polyline points="' +
        points.join(' ') + '"></polyline>' + points.map(point => {
          const [x, y] = point.split(',');
          return '<circle cx="' + x + '" cy="' + y + '" r="4"></circle>';
        }).join('') + '</svg>';
      chart.setAttribute('aria-label', 'Biểu đồ doanh thu phòng năm ' + selectedYear + ': ' + formatCurrency(totalYear) + '. Chưa có dữ liệu doanh thu dịch vụ.');
    }

    const chartAxis = document.querySelector('#income-chart-axis');
    if (chartAxis) {
      chartAxis.innerHTML = [1, .75, .5, .25, 0].map(fraction =>
        '<span>' + formatCurrency(maxChartAmount * fraction) + '</span>'
      ).join('');
    }

    const compositionChart = document.querySelector('#income-composition-chart');
    const compositionLegend = document.querySelector('#income-composition-legend');
    const roomShare = totalYear > 0 ? 100 : 0;
    if (compositionChart) {
      compositionChart.style.setProperty('--room-share', roomShare + '%');
      compositionChart.style.background = totalYear > 0
        ? 'conic-gradient(#cf3c70 0 ' + roomShare + '%, #f3a5ba ' + roomShare + '%)'
        : '#f1ecef';
      compositionChart.setAttribute('aria-label', 'Doanh thu phòng: ' + formatCurrency(totalYear) + ' (' + roomShare +
        '%). Doanh thu dịch vụ: 0đ.');
      compositionChart.innerHTML = '<div><strong>' + escapeHtml((totalYear / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })) +
        '</strong><span>triệu đồng</span></div>';
    }
    if (compositionLegend) {
      compositionLegend.innerHTML =
        '<li><i class="room-revenue"></i><span>Doanh thu phòng</span><strong>' + formatCurrency(totalYear) + ' <small>(' + roomShare + '%)</small></strong></li>' +
        '<li><i class="service-revenue"></i><span>Doanh thu dịch vụ</span><strong>0đ <small>(0%)</small></strong></li>';
    }

    const topRoomsList = document.querySelector('#income-top-rooms');
    if (topRoomsList) {
      const roomTotals = new Map();
      bookingCache.forEach(booking => {
        if (booking.status !== 'checked_out' || !booking.actualCheckOutAt) return;
        const checkOutDate = new Date(booking.actualCheckOutAt);
        if (!Number.isFinite(checkOutDate.getTime()) || checkOutDate.getFullYear() !== selectedYear) return;
        const room = roomCache.find(item => String(item.id) === String(booking.roomId));
        const roomKey = String(booking.roomId || booking.roomCode || room?.roomCode || 'unknown');
        const value = roomTotals.get(roomKey) || {
          code: booking.roomCode || room?.roomCode || room?.room_code || room?.roomNumber || 'Chưa rõ phòng',
          type: roomTypeLabel(room?.roomType || room?.room_type || booking.roomType || ''),
          image: room?.imagePath || room?.image_path || '/assets/room-placeholder.svg',
          amount: 0,
          bookings: 0
        };
        value.amount += Number(booking.rentalTotal) || 0;
        value.bookings += 1;
        roomTotals.set(roomKey, value);
      });
      const topRooms = [...roomTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
      topRoomsList.innerHTML = topRooms.length ? topRooms.map((room, index) =>
        '<li><span class="income-room-rank">' + (index + 1) + '</span><img src="' + escapeHtml(room.image) +
        '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'/assets/room-placeholder.svg\'"><span class="income-room-info"><strong>' +
        escapeHtml(room.code) + (room.type ? ' - ' + escapeHtml(room.type) : '') + '</strong><small>' + room.bookings +
        ' lượt trả phòng</small></span><strong class="income-room-revenue">' + formatCurrency(room.amount) + '</strong></li>'
      ).join('') : '<li class="income-room-empty">Chưa có dữ liệu doanh thu phòng trong năm này.</li>';
    }

    const occupiedRooms = roomCache.filter(room => statusOf(room) === 'occupied').length;
    const occupancy = roomCache.length ? Math.round(occupiedRooms / roomCache.length * 100) : 0;
    const averageRevenue = completedBookings ? totalYear / completedBookings : 0;
    const occupancyCell = document.querySelector('#income-occupancy-rate');
    const checkoutCell = document.querySelector('#income-activity-checkouts');
    const roomCountCell = document.querySelector('#income-activity-room-count');
    const averageRevenueCell = document.querySelector('#income-average-booking-revenue');
    if (occupancyCell) occupancyCell.textContent = occupancy + '%';
    if (checkoutCell) checkoutCell.textContent = String(completedBookings);
    if (roomCountCell) roomCountCell.textContent = String(roomCache.length);
    if (averageRevenueCell) averageRevenueCell.textContent = formatCurrency(averageRevenue);

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
  document.querySelector('#income-view .income-chart-panel')?.addEventListener('click', event => {
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
    renderIncomeReport();
  });
  const incomeExportDialog = document.querySelector('#income-export-dialog');
  const incomeExportYear = document.querySelector('#income-export-year');
  const incomeExportFrom = document.querySelector('#income-export-from');
  const incomeExportTo = document.querySelector('#income-export-to');
  const incomeExportTitle = document.querySelector('#income-export-custom-title');
  const incomeExportPreview = document.querySelector('#income-export-preview');
  const incomeExportError = document.querySelector('#income-export-error');
  let incomeExportLogo = '';
  let incomeExportTitleTouched = false;

  function localDateInputValue(value) {
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  }

  function selectedExportPeriod() {
    return incomeExportDialog?.querySelector('input[name="income-export-period"]:checked')?.value || 'year';
  }

  function updateDefaultExportTitle() {
    if (!incomeExportTitle || incomeExportTitleTouched) return;
    const period = selectedExportPeriod();
    const year = incomeExportYear?.value || String(new Date().getFullYear());
    const labels = {
      today: 'hôm nay',
      '7days': '7 ngày gần đây',
      '30days': '30 ngày gần đây',
      month: 'tháng ' + new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(new Date()),
      quarter: 'quý ' + (Math.floor(new Date().getMonth() / 3) + 1) + ' năm ' + new Date().getFullYear(),
      year: 'năm ' + year,
      custom: 'theo khoảng thời gian tùy chọn'
    };
    incomeExportTitle.value = 'Báo cáo thống kê thu nhập ' + labels[period];
  }

  function setExportDateRange() {
    const today = new Date();
    const selectedYear = Number(incomeExportYear?.value) || today.getFullYear();
    let start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let end = new Date(start);
    switch (selectedExportPeriod()) {
      case '7days':
        start.setDate(start.getDate() - 6);
        break;
      case '30days':
        start.setDate(start.getDate() - 29);
        break;
      case 'month':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'quarter':
        start = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
        break;
      case 'year':
        start = new Date(selectedYear, 0, 1);
        end = new Date(selectedYear, 11, 31);
        break;
      case 'custom':
        return;
      default:
        break;
    }
    if (incomeExportFrom) incomeExportFrom.value = localDateInputValue(start);
    if (incomeExportTo) incomeExportTo.value = localDateInputValue(end);
  }

  function getExportRange() {
    if (!incomeExportFrom?.value || !incomeExportTo?.value) return null;
    const start = new Date(incomeExportFrom.value + 'T00:00:00');
    const end = new Date(incomeExportTo.value + 'T00:00:00');
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return null;
    return { start, end };
  }

  function createExportReport() {
    const range = getExportRange();
    if (!range) {
      if (incomeExportError) {
        incomeExportError.hidden = false;
        incomeExportError.textContent = 'Vui lòng chọn khoảng ngày hợp lệ; ngày bắt đầu không được sau ngày kết thúc.';
      }
      return null;
    }
    if (incomeExportError) {
      incomeExportError.hidden = true;
      incomeExportError.textContent = '';
    }

    const endExclusive = new Date(range.end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const completed = bookingCache.filter(booking => {
      if (booking.status !== 'checked_out' || !booking.actualCheckOutAt) return false;
      const date = new Date(booking.actualCheckOutAt);
      return Number.isFinite(date.getTime()) && date >= range.start && date < endExclusive;
    });
    const months = [];
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    const lastMonth = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
    while (cursor <= lastMonth) {
      months.push({ year: cursor.getFullYear(), month: cursor.getMonth(), amount: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const monthIndexes = new Map(months.map((item, index) => [item.year + '-' + item.month, index]));
    const roomTotals = new Map();
    completed.forEach(booking => {
      const date = new Date(booking.actualCheckOutAt);
      const monthIndex = monthIndexes.get(date.getFullYear() + '-' + date.getMonth());
      if (monthIndex !== undefined) months[monthIndex].amount += Number(booking.rentalTotal) || 0;
      const room = roomCache.find(item => String(item.id) === String(booking.roomId));
      const key = String(booking.roomId || booking.roomCode || room?.roomCode || 'unknown');
      const roomEntry = roomTotals.get(key) || {
        code: booking.roomCode || room?.roomCode || room?.room_code || room?.roomNumber || 'Chưa rõ phòng',
        type: roomTypeLabel(room?.roomType || room?.room_type || booking.roomType || ''),
        image: room?.imagePath || room?.image_path || '/assets/room-placeholder.svg',
        amount: 0,
        bookings: 0
      };
      roomEntry.amount += Number(booking.rentalTotal) || 0;
      roomEntry.bookings += 1;
      roomTotals.set(key, roomEntry);
    });
    const total = months.reduce((sum, item) => sum + item.amount, 0);
    const formatCurrency = amount => Number(amount).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';
    const formatDate = value => [
      String(value.getDate()).padStart(2, '0'),
      String(value.getMonth() + 1).padStart(2, '0'),
      value.getFullYear()
    ].join('/');
    const report = document.querySelector('#income-view .income-report-board');
    if (!report || !incomeExportPreview) return null;
    const clone = report.cloneNode(true);
    const title = incomeExportTitle?.value.trim() || 'Báo cáo thống kê thu nhập';
    clone.querySelector('.income-report-header h2').textContent = title;
    clone.querySelector('.income-report-header p').textContent = formatDate(range.start) + ' - ' + formatDate(range.end);

    const monthlyTotal = clone.querySelector('#income-year-total');
    const roomTotal = clone.querySelector('#income-room-total');
    const bookingCount = clone.querySelector('#income-booking-count');
    if (monthlyTotal) monthlyTotal.textContent = formatCurrency(total);
    if (roomTotal) roomTotal.textContent = formatCurrency(total);
    if (bookingCount) bookingCount.textContent = String(completed.length);
    const yearChange = clone.querySelector('#income-year-change');
    if (yearChange) yearChange.textContent = 'Trong kỳ';

    const tableBody = clone.querySelector('#income-table-body');
    if (tableBody) {
      tableBody.innerHTML = months.map((item, index) => {
        const previous = index ? months[index - 1].amount : 0;
        const change = index === 0 ? '—' : previous > 0
          ? (item.amount >= previous ? '↑ ' : '↓ ') + Math.round(Math.abs(item.amount - previous) / previous * 100) + '%'
          : item.amount > 0 ? 'Mới' : '—';
        const changeClass = index === 0 ? 'neutral' : item.amount >= previous ? 'positive' : 'negative';
        return '<tr><td>Tháng ' + (item.month + 1) + '/' + item.year + '</td><td>' + formatCurrency(item.amount) +
          '</td><td>0đ</td><td>' + formatCurrency(item.amount) +
          '</td><td><span class="income-change ' + changeClass + '">' + change + '</span></td></tr>';
      }).join('');
    }
    const roomFooter = clone.querySelector('#income-room-total-footer');
    const yearFooter = clone.querySelector('#income-year-total-footer');
    if (roomFooter) roomFooter.textContent = formatCurrency(total);
    if (yearFooter) yearFooter.textContent = formatCurrency(total);
    const yearChangeFooter = clone.querySelector('#income-year-change-footer');
    if (yearChangeFooter) yearChangeFooter.textContent = 'Trong kỳ';

    const chart = clone.querySelector('#income-monthly-chart');
    const maxAmount = Math.max(...months.map(item => item.amount), 1);
    if (chart) {
      chart.style.gridTemplateColumns = 'repeat(' + Math.max(months.length, 1) + ', minmax(0, 1fr))';
      const points = months.map((item, index) =>
        ((index + .5) / months.length * 1200).toFixed(1) + ',' + (145 - item.amount / maxAmount * 116).toFixed(1)
      );
      chart.innerHTML = months.map(item => {
        const height = item.amount > 0 ? Math.max(1, item.amount / maxAmount * 100) : 0;
        return '<div class="income-chart-month" title="' + (item.month + 1) + '/' + item.year + ': ' + formatCurrency(item.amount) +
          '"><div class="income-chart-bars"><i class="room-revenue" style="--bar-height:' + height +
          '%"></i><i class="service-revenue" style="--bar-height:0%"></i></div><span>T' + (item.month + 1) + '</span></div>';
      }).join('') + '<svg class="income-chart-total-line" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true"><polyline points="' +
        points.join(' ') + '"></polyline>' + points.map(point => {
          const [x, y] = point.split(',');
          return '<circle cx="' + x + '" cy="' + y + '" r="4"></circle>';
        }).join('') + '</svg>';
    }
    const axis = clone.querySelector('#income-chart-axis');
    if (axis) axis.innerHTML = [1, .75, .5, .25, 0].map(fraction =>
      '<span>' + formatCurrency(maxAmount * fraction) + '</span>'
    ).join('');
    const composition = clone.querySelector('#income-composition-chart');
    if (composition) {
      composition.style.background = total > 0 ? 'conic-gradient(var(--income-export-accent) 0 100%, #f3a5ba 100%)' : '#f1ecef';
      composition.setAttribute('aria-label', 'Doanh thu phòng: ' + formatCurrency(total) + ' (100%). Doanh thu dịch vụ: 0đ.');
      composition.innerHTML = '<div><strong>' + escapeHtml((total / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })) +
        '</strong><span>triệu đồng</span></div>';
    }
    const compositionLegend = clone.querySelector('#income-composition-legend');
    if (compositionLegend) compositionLegend.innerHTML =
      '<li><i class="room-revenue"></i><span>Doanh thu phòng</span><strong>' + formatCurrency(total) + ' <small>(100%)</small></strong></li>' +
      '<li><i class="service-revenue"></i><span>Doanh thu dịch vụ</span><strong>0đ <small>(0%)</small></strong></li>';

    const topRooms = clone.querySelector('#income-top-rooms');
    if (topRooms) {
      const entries = [...roomTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
      topRooms.innerHTML = entries.length ? entries.map((room, index) =>
        '<li><span class="income-room-rank">' + (index + 1) + '</span><img src="' + escapeHtml(room.image) +
        '" alt=""><span class="income-room-info"><strong>' + escapeHtml(room.code) +
        (room.type ? ' - ' + escapeHtml(room.type) : '') + '</strong><small>' + room.bookings +
        ' lượt trả phòng</small></span><strong class="income-room-revenue">' + formatCurrency(room.amount) + '</strong></li>'
      ).join('') : '<li class="income-room-empty">Chưa có doanh thu trong kỳ.</li>';
    }
    const activityCount = clone.querySelector('#income-activity-checkouts');
    const activityRooms = clone.querySelector('#income-activity-room-count');
    const averageRevenue = clone.querySelector('#income-average-booking-revenue');
    if (activityCount) activityCount.textContent = String(completed.length);
    if (activityRooms) activityRooms.textContent = String(roomCache.length);
    if (averageRevenue) averageRevenue.textContent = formatCurrency(completed.length ? total / completed.length : 0);

    const periodText = formatDate(range.start) + ' - ' + formatDate(range.end);
    const paper = incomeExportPreview;
    paper.replaceChildren();
    const brand = document.createElement('div');
    brand.className = 'income-export-preview-brand';
    if (incomeExportLogo) {
      const logo = document.createElement('img');
      logo.src = incomeExportLogo;
      logo.alt = '';
      brand.append(logo);
    }
    brand.append(document.createTextNode('KHÁCH SẠN'));
    paper.append(brand);
    const previewTitle = document.createElement('h2');
    previewTitle.textContent = title;
    paper.append(previewTitle);
    const previewPeriod = document.createElement('p');
    previewPeriod.className = 'income-export-preview-period';
    previewPeriod.textContent = periodText;
    paper.append(previewPeriod);
    paper.append(clone);
    const footer = document.createElement('div');
    footer.className = 'income-export-preview-footer';
    footer.innerHTML = '<span>Ngày xuất: ' + escapeHtml(new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())) +
      '</span><span>Trang 1/1</span>';
    paper.append(footer);

    const visibility = {
      summary: clone.querySelector('.income-report-summary'),
      chart: clone.querySelector('.income-chart-panel'),
      table: clone.querySelector('.income-table-panel'),
      composition: clone.querySelector('.income-composition-panel'),
      topRooms: clone.querySelector('.income-top-rooms-panel'),
      activity: clone.querySelector('.income-activity-panel'),
      notes: clone.querySelector('.income-data-note')
    };
    incomeExportDialog.querySelectorAll('[data-export-section]').forEach(input => {
      const target = visibility[input.dataset.exportSection];
      if (target) target.hidden = !input.checked;
    });
    const sidePanels = clone.querySelector('.income-report-side-panels');
    if (sidePanels) sidePanels.hidden = !visibility.topRooms?.hidden && !visibility.activity?.hidden
      ? false : !incomeExportDialog.querySelector('[data-export-section="topRooms"]').checked
        && !incomeExportDialog.querySelector('[data-export-section="activity"]').checked;
    const theme = incomeExportDialog.querySelector('input[name="income-export-theme"]:checked')?.value || '#d93670';
    incomeExportDialog.style.setProperty('--income-export-accent', theme);
    paper.style.setProperty('--income-export-accent', theme);
    return { paper, title, periodText };
  }

  function openExportDocument(shouldPrint) {
    const report = createExportReport();
    if (!report) return;
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      if (incomeExportError) {
        incomeExportError.hidden = false;
        incomeExportError.textContent = 'Trình duyệt đã chặn cửa sổ báo cáo. Hãy cho phép cửa sổ bật lên rồi thử lại.';
      }
      return;
    }
    previewWindow.addEventListener('load', () => {
      if (shouldPrint) previewWindow.print();
    }, { once: true });
    previewWindow.document.open();
    previewWindow.document.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      escapeHtml(report.title) + '</title><base href="' + escapeHtml(window.location.origin) +
      '/"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/dashboard.css"><style>' +
      'body.dashboard-page{display:block!important;margin:0!important;padding:18px!important;background:#fff!important}.income-export-preview-paper{width:100%;max-width:none;min-height:0;padding:0;box-shadow:none!important}.income-export-preview-paper .income-report-board{width:100%;max-width:none}.income-export-preview-paper .income-report-panels,.income-export-preview-paper .income-report-lower-panels{break-inside:avoid}.income-export-preview-paper .income-report-table-wrap{overflow:visible}.income-export-preview-paper .income-report-table{min-width:0}@page{size:A4 portrait;margin:12mm}@media print{body.dashboard-page{padding:0!important}body.dashboard-page *{visibility:visible!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.income-export-preview-paper{break-inside:avoid}.income-export-preview-paper .income-report-table tr{break-inside:avoid}}' +
      '</style></head><body class="dashboard-page"><main class="income-export-preview-paper">' +
      report.paper.innerHTML + '</main></body></html>');
    previewWindow.document.close();
  }

  function refreshExportPreview() {
    createExportReport();
    const confirmButton = document.querySelector('#income-export-confirm');
    if (confirmButton) confirmButton.disabled = !getExportRange();
  }

  function openIncomeExportDialog() {
    if (!incomeExportDialog) return;
    const year = document.querySelector('#income-year-select')?.value || String(new Date().getFullYear());
    const yearOptions = [...(document.querySelector('#income-year-select')?.options || [])].map(option => option.value);
    if (incomeExportYear) {
      incomeExportYear.innerHTML = [...new Set([year, ...yearOptions])].map(value =>
        '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>'
      ).join('');
      incomeExportYear.value = year;
    }
    incomeExportTitleTouched = false;
    if (incomeExportTitle) incomeExportTitle.value = 'Báo cáo thống kê thu nhập năm ' + year;
    const yearPeriod = incomeExportDialog.querySelector('input[name="income-export-period"][value="year"]');
    if (yearPeriod) yearPeriod.checked = true;
    setExportDateRange();
    if (incomeExportError) {
      incomeExportError.hidden = true;
      incomeExportError.textContent = '';
    }
    incomeExportDialog.showModal();
    refreshExportPreview();
  }

  document.querySelector('#income-export-pdf')?.addEventListener('click', openIncomeExportDialog);
  document.querySelectorAll('[data-income-export-close]').forEach(button =>
    button.addEventListener('click', () => incomeExportDialog?.close())
  );
  incomeExportDialog?.addEventListener('click', event => {
    if (event.target === incomeExportDialog) incomeExportDialog.close();
  });
  incomeExportDialog?.querySelectorAll('input[name="income-export-period"]').forEach(input =>
    input.addEventListener('change', () => {
      setExportDateRange();
      updateDefaultExportTitle();
      refreshExportPreview();
    })
  );
  incomeExportYear?.addEventListener('change', () => {
    if (selectedExportPeriod() === 'year') setExportDateRange();
    updateDefaultExportTitle();
    refreshExportPreview();
  });
  [incomeExportFrom, incomeExportTo].forEach(input => input?.addEventListener('change', () => {
    const customPeriod = incomeExportDialog.querySelector('input[name="income-export-period"][value="custom"]');
    if (customPeriod) customPeriod.checked = true;
    updateDefaultExportTitle();
    refreshExportPreview();
  }));
  incomeExportDialog?.querySelectorAll('[data-export-section], input[name="income-export-theme"]')
    .forEach(input => input.addEventListener('change', refreshExportPreview));
  incomeExportTitle?.addEventListener('input', () => {
    incomeExportTitleTouched = true;
    refreshExportPreview();
  });
  incomeExportDialog?.querySelector('#income-export-logo')?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    const status = document.querySelector('#income-export-logo-status');
    if (!file) {
      incomeExportLogo = '';
      refreshExportPreview();
      return;
    }
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      event.target.value = '';
      if (status) status.textContent = 'Chỉ hỗ trợ ảnh PNG/JPG tối đa 2MB.';
      incomeExportLogo = '';
      refreshExportPreview();
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      incomeExportLogo = typeof reader.result === 'string' ? reader.result : '';
      if (status) status.textContent = file.name;
      refreshExportPreview();
    });
    reader.addEventListener('error', () => {
      if (status) status.textContent = 'Không đọc được tệp ảnh. Vui lòng thử lại.';
    });
    reader.readAsDataURL(file);
  });
  document.querySelector('#income-export-preview-full')?.addEventListener('click', () => openExportDocument(false));
  document.querySelector('#income-export-confirm')?.addEventListener('click', () => openExportDocument(true));

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
})();
