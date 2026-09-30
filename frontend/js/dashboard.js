(() => {
  const overview = document.querySelector('#overview-view');
  if (!overview) return;
  const date = new Date();
  const dateLabel = document.querySelector('#dashboard-date');
  dateLabel.dateTime = date.toISOString();
  dateLabel.textContent = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  const hour = date.getHours();
  document.querySelector('#greeting').textContent = hour < 12 ? 'Chào buổi sáng!' : hour < 18 ? 'Chào buổi chiều!' : 'Chào buổi tối!';
  const search = document.querySelector('#overview-search');
  const statusFilter = document.querySelector('#overview-status');
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const statusOf = room => roomStatusInfo(room.status).className;

  function renderMap() {
    const query = normalized(search.value.trim());
    const rooms = roomCache.filter(room => (!statusFilter.value || statusOf(room) === statusFilter.value)
      && normalized((room.roomCode || '') + ' ' + (room.roomType || '')).includes(query));
    document.querySelector('#overview-room-map').innerHTML = rooms.length ? rooms.map(room => {
      const status = statusOf(room);
      const label = status === 'occupied' ? 'Có khách' : status === 'available' ? 'Trống' : (room.status || 'Chưa cập nhật');
      return '<button type="button" class="map-room ' + status + '" data-map-room="' + escapeHtml(room.id) + '" aria-label="Cập nhật phòng ' + escapeHtml(room.roomCode) + ' — ' + escapeHtml(label) + '"><strong>' + escapeHtml(room.roomCode) + '</strong><span><i></i>' + escapeHtml(label) + '</span></button>';
    }).join('') : '<p class="map-empty">Không có phòng phù hợp.</p>';
  }

  function renderTypes() {
    const names = [...new Set([...roomTypesCache.map(type => type.name), ...roomCache.map(room => room.roomType || 'Chưa phân loại')])];
    document.querySelector('#overview-types').innerHTML = names.length ? names.map(name => {
      const rooms = roomCache.filter(room => (room.roomType || 'Chưa phân loại') === name);
      return '<tr><td>' + escapeHtml(roomTypeLabel(name)) + '</td><td>' + rooms.length + '</td><td>' + rooms.filter(room => statusOf(room) === 'available').length + '</td></tr>';
    }).join('') : '<tr><td colspan="3">Chưa có thể loại phòng.</td></tr>';
  }

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
  }

  document.addEventListener('rooms-updated', renderOverview);
  document.addEventListener('room-types-updated', () => { if (!document.querySelector('#overview-error').textContent) renderTypes(); });
  document.addEventListener('rooms-error', event => {
    text('overview-error', event.detail);
    for (const key of ['total', 'occupied', 'available', 'other']) { text('stat-' + key, '—'); text('legend-' + key, '—'); }
    text('occupancy-percent', '—');
    document.querySelector('#occupancy-chart').style.background = '#eee8ec';
    document.querySelector('#occupancy-chart').setAttribute('aria-label', 'Không tải được dữ liệu');
    text('overview-room-map', 'Không tải được danh sách phòng. Vui lòng tải lại trang.');
    document.querySelector('#overview-types').innerHTML = '<tr><td colspan="3">Không tải được dữ liệu phòng.</td></tr>';
  });
  search.addEventListener('input', renderMap);
  statusFilter.addEventListener('change', renderMap);
  document.querySelector('#overview-room-map').addEventListener('click', event => {
    const button = event.target.closest('[data-map-room]');
    if (!button) return;
    const room = roomCache.find(room => String(room.id) === button.dataset.mapRoom);
    if (room && openRoomForm) openRoomForm(room);
  });
})();
