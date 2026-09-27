const form = document.querySelector('#login-form');

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
  } catch {
    window.location.href = '/login.html';
  }
}

loadSession();