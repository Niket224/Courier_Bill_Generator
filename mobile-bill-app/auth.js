// Cookie sessions stay HttpOnly. The CSRF token exists only in this closure.
(() => {
  const base = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? `${location.protocol}//${location.hostname}:5000/api` : '/api';
  let csrfToken = null;
  let authenticated = false;
  let expiryTimer;
  let signInStarted = false;
  const panel = document.getElementById('loginPanel');
  const shell = document.querySelector('.app-shell');
  const message = document.getElementById('loginMessage');
  function lock(text = 'Sign in to access your billing workspace.') {
    csrfToken = null;
    authenticated = false;
    clearTimeout(expiryTimer);
    shell.hidden = true;
    panel.hidden = false;
    message.textContent = text;
    document.getElementById('loginPassword').value = '';
  }
  function unlock(data) {
    if (!data.authenticated || typeof data.csrfToken !== 'string' || !Number.isFinite(data.expiresAt)) throw new Error('Unable to verify session. Please sign in again.');
    csrfToken = data.csrfToken;
    authenticated = true;
    shell.hidden = false;
    panel.hidden = true;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => lock('Your session expired. Sign in again; your draft is preserved.'), Math.max(0, data.expiresAt - Date.now()));
  }
  async function apiFetch(url, options = {}) {
    if (!authenticated) { lock(); throw new Error('Please sign in to continue.'); }
    const headers = new Headers(options.headers);
    if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', csrfToken);
    let response;
    try { response = await fetch(url, { ...options, headers, credentials: 'include', cache: 'no-store' }); }
    catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
    if (response.status === 401) {
      lock('Your session expired. Sign in again; your draft is preserved.');
      throw new Error('Please sign in again.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.code === 'CSRF_INVALID') lock('Your session needs refreshing. Please sign in again.');
      throw new Error(data.error || 'Unable to complete request. Please try again.');
    }
    return response;
  }
  window.CourierAuth = { apiFetch, isAuthenticated: () => authenticated };
  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    signInStarted = true;
    const button = document.getElementById('loginButton');
    button.disabled = true;
    message.textContent = 'Signing in…';
    try {
      const challenge = await fetch(`${base}/auth/csrf`, { credentials: 'include', cache: 'no-store' });
      if (!challenge.ok) throw new Error('Unable to start sign-in. Please try again later.');
      const { csrfToken: loginToken } = await challenge.json();
      const response = await fetch(`${base}/auth/login`, { method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginToken },
        body: JSON.stringify({ username: document.getElementById('loginUsername').value,
          password: document.getElementById('loginPassword').value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sign-in failed.');
      unlock(data);
    } catch (error) {
      lock(error instanceof TypeError ? 'Cannot reach the server. Please try again.' : error.message);
    } finally {
      document.getElementById('loginPassword').value = '';
      button.disabled = false;
    }
  });
  document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await apiFetch(`${base}/auth/logout`, { method: 'POST' }); lock('Signed out. Your draft is preserved on this device.'); }
    catch (error) { if (authenticated) window.alert(error.message); }
  });
  fetch(`${base}/auth/session`, { credentials: 'include', cache: 'no-store' })
    .then(async (response) => {
      const data = response.ok ? await response.json() : null;
      if (!signInStarted) data ? unlock(data) : lock();
    })
    .catch(() => { if (!signInStarted) lock('Cannot verify your session. Check the server connection and sign in.'); });
})();
