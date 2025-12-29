const container = document.querySelector('.container');const container = document.querySelector('.container');















































































































































});    }        setMsg(registerMessage, err?.message || 'Unable to create HR user', 'error');    } catch (err) {        container?.classList.remove('active');        setMsg(registerMessage, 'HR user created. You can sign in now.', 'ok');        if (!res.ok) throw new Error(data.error || 'Failed to create HR user');        const data = await jsonOrEmpty(res);        });            body: JSON.stringify({ name, pin })            },                'Authorization': `Bearer ${token}`                'Content-Type': 'application/json',            headers: {            method: 'POST',        const res = await fetch(`${API_URL}/auth/hr/users`, {    try {    setMsg(registerMessage, 'Creating HR user...', 'ok');    }        return;        setMsg(registerMessage, 'Login as HR first (Admin/1234) to create users.', 'error');    if (!token) {    }        return;        setMsg(registerMessage, 'Enter HR name and PIN.', 'error');    if (!name || !pin) {    const token = localStorage.getItem('hrToken') || '';    const pin = document.getElementById('regPin')?.value?.trim() || '';    const name = document.getElementById('regName')?.value?.trim() || '';    e.preventDefault();registerForm?.addEventListener('submit', async (e) => {const registerMessage = document.getElementById('registerMessage');const registerForm = document.getElementById('registerForm');// Optional: HR user creation (requires an HR token already)});    }        setMsg(loginMessage, err?.message || 'Unable to login', 'error');    } catch (err) {        setTimeout(redirectToApp, 350);        setMsg(loginMessage, 'Logged in. Redirecting...', 'ok');        }            localStorage.setItem('employeeId', String(data?.employee?.id || ''));            localStorage.setItem('employeeName', data?.employee?.name || 'Employee');            localStorage.setItem('employeeToken', data.token);            localStorage.removeItem('hrName');            localStorage.removeItem('hrToken');        } else {            localStorage.setItem('hrName', data?.hr?.name || user);            localStorage.setItem('hrToken', data.token);            localStorage.removeItem('employeeId');            localStorage.removeItem('employeeName');            localStorage.removeItem('employeeToken');        if (role === 'hr') {        }            throw new Error(data.error || 'Login failed');        if (!res.ok) {        const data = await jsonOrEmpty(res);        });            body: JSON.stringify(payload)            headers: { 'Content-Type': 'application/json' },            method: 'POST',        const res = await fetch(url, {        const payload = role === 'hr' ? { name: user, pin } : { email: user, pin };        const url = role === 'hr' ? `${API_URL}/auth/hr/login` : `${API_URL}/auth/employee/login`;    try {    setMsg(loginMessage, 'Signing in...', 'ok');    }        return;        setMsg(loginMessage, 'Please enter your credentials.', 'error');    if (!user || !pin) {    const role = (loginForm.querySelector('input[name="role"]:checked')?.value) || 'employee';    const pin = document.getElementById('loginPin')?.value?.trim() || '';    const user = document.getElementById('loginUser')?.value?.trim() || '';    e.preventDefault();loginForm?.addEventListener('submit', async (e) => {const loginMessage = document.getElementById('loginMessage');const loginForm = document.getElementById('loginForm');}    window.location.href = './index.html';    // dashboard is the existing UIfunction redirectToApp() {}    try { return await res.json(); } catch { return {}; }async function jsonOrEmpty(res) {}    el.style.color = kind === 'error' ? 'rgba(255, 210, 210, 0.95)' : 'rgba(210, 255, 230, 0.95)';    el.style.opacity = text ? '1' : '0.9';    el.textContent = text || '';    if (!el) return;function setMsg(el, text, kind) {})();    return 'http://127.0.0.1:3000';    } catch {}        }            return `${protocol}//${hostname}:3000`;            if (isLocalHost) return 'http://127.0.0.1:3000';        if (isHttp) {        const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';        const isHttp = protocol.startsWith('http');        const hostname = (loc?.hostname || '').trim();        const protocol = loc?.protocol || '';        const loc = window.location;    try {const API_URL = (() => {});    container?.classList.remove('active');    e.preventDefault();LoginLink?.addEventListener('click', (e) => {});    container?.classList.add('active');    e.preventDefault();RegisterLink?.addEventListener('click', (e) => {const RegisterLink = document.querySelector('.SignUpLink');const LoginLink = document.querySelector('.SignInLink');const LoginLink = document.querySelector('.SignInLink');
const RegisterLink = document.querySelector('.SignUpLink');

RegisterLink?.addEventListener('click', (e) => {
    e.preventDefault();
    container?.classList.add('active');
});

LoginLink?.addEventListener('click', (e) => {
    e.preventDefault();
    container?.classList.remove('active');
});

const API_URL = (() => {
    try {
        const loc = window.location;
        const protocol = loc?.protocol || '';
        const hostname = (loc?.hostname || '').trim();

        const isHttp = protocol.startsWith('http');
        const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

        if (isHttp) {
            if (isLocalHost) return 'http://localhost:3000';
            return `${protocol}//${hostname}:3000`;
        }
    } catch {}
    return 'http://localhost:3000';
})();

function setMessage(el, msg, kind = 'info') {
    if (!el) return;
    el.textContent = msg || '';
    el.dataset.kind = kind;
}

function getSelectedRole(form) {
    const picked = form.querySelector('input[name="role"]:checked');
    return picked ? String(picked.value) : 'employee';
}

async function login({ role, user, pin }) {
    const isHR = role === 'hr';
    const endpoint = isHR ? '/auth/hr/login' : '/auth/employee/login';
    const payload = isHR ? { name: user, pin } : { email: user, pin };

    const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed');

    if (isHR) {
        localStorage.removeItem('employeeToken');
        localStorage.removeItem('employeeName');
        localStorage.removeItem('employeeId');

        localStorage.setItem('hrToken', data.token);
        localStorage.setItem('hrName', data?.hr?.name || user);
    } else {
        localStorage.removeItem('hrToken');
        localStorage.removeItem('hrName');

        localStorage.setItem('employeeToken', data.token);
        localStorage.setItem('employeeName', data?.employee?.name || 'Employee');
        localStorage.setItem('employeeId', String(data?.employee?.id || ''));
    }

    return true;
}

async function createHrUser({ name, pin }) {
    const hrToken = localStorage.getItem('hrToken');
    if (!hrToken) throw new Error('HR token missing. Login as Admin first (default Admin/1234).');

    const res = await fetch(`${API_URL}/auth/hr/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hrToken}` },
        body: JSON.stringify({ name, pin })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create HR user');
    return data;
}

const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const user = String(document.getElementById('loginUser')?.value || '').trim();
    const pin = String(document.getElementById('loginPin')?.value || '').trim();
    const role = getSelectedRole(loginForm);

    if (!user || !pin) {
        setMessage(loginMessage, 'Please enter your login and PIN.', 'error');
        return;
    }

    setMessage(loginMessage, 'Signing in...', 'info');

    try {
        await login({ role, user, pin });
        setMessage(loginMessage, 'Login successful. Redirecting...', 'success');
        window.location.href = './index.html';
    } catch (err) {
        setMessage(loginMessage, err?.message || 'Login failed', 'error');
    }
});

const registerForm = document.getElementById('registerForm');
const registerMessage = document.getElementById('registerMessage');

registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = String(document.getElementById('regName')?.value || '').trim();
    const pin = String(document.getElementById('regPin')?.value || '').trim();

    if (!name || !pin) {
        setMessage(registerMessage, 'Please enter name and PIN.', 'error');
        return;
    }

    setMessage(registerMessage, 'Creating HR user...', 'info');

    try {
        await createHrUser({ name, pin });
        setMessage(registerMessage, 'HR user created. You can sign in now.', 'success');
        container?.classList.remove('active');
    } catch (err) {
        setMessage(registerMessage, err?.message || 'Registration failed', 'error');
    }
});
