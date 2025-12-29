// Toggle between Login and Register (matches your snippet)
const container = document.querySelector('.container');
const loginLink = document.querySelector('.SignInLink');
const registerLink = document.querySelector('.SignUpLink');

registerLink?.addEventListener('click', (e) => {
    e.preventDefault();
    container?.classList.add('active');
});

loginLink?.addEventListener('click', (e) => {
    e.preventDefault();
    container?.classList.remove('active');
});

const API_URL = (() => {
    try {
        const loc = window.location;
        const protocol = loc?.protocol || '';
        const hostname = (loc?.hostname || '').trim();

        const isHttp = protocol.startsWith('http');
        if (!isHttp) return 'http://localhost:3000';

        const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
        if (isLocalHost) return 'http://localhost:3000';

        const suffix = hostname.match(/^(.*)-(\d+)(\..*)$/);
        if (suffix) {
            return `${protocol}//${suffix[1]}-3000${suffix[3]}`;
        }

        const prefix = hostname.match(/^(\d+)-(.*)$/);
        if (prefix) {
            return `${protocol}//3000-${prefix[2]}`;
        }

        return `${protocol}//${hostname}:3000`;
    } catch {}
    return 'http://localhost:3000';
})();

function setMessage(el, msg, kind = 'info') {
    if (!el) return;
    el.textContent = msg || '';
    el.dataset.kind = kind;
}

function redirectToApp() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const next = (params.get('next') || '').trim();
        if (next) {
            try { sessionStorage.setItem('emsNextRoute', next); } catch {}
        }
    } catch {}
    try {
        const url = new URL('index.html', window.location.href);
        url.searchParams.set('app', '1');
        window.location.assign(url.toString());
        return;
    } catch {}
    window.location.href = './index.html?app=1';
}

function redirectToAppWithAuth(authPayload) {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const next = (params.get('next') || '').trim();
        if (next) {
            try { sessionStorage.setItem('emsNextRoute', next); } catch {}
        }
    } catch {}
    try {
        const encoded = encodeURIComponent(JSON.stringify(authPayload || {}));
        const url = new URL('index.html', window.location.href);
        url.searchParams.set('app', '1');
        url.hash = `auth=${encoded}`;

        // Navigate immediately, and retry once in case a browser extension blocks the first attempt.
        window.location.assign(url.toString());
        setTimeout(() => {
            try {
                if (String(window.location.href).includes('login.html')) {
                    window.location.assign(url.toString());
                }
            } catch {}
        }, 400);
        return;
    } catch {}
    redirectToApp();
}

async function jsonOrEmpty(res) {
    try {
        return await res.json();
    } catch {
        return {};
    }
}

async function doLogin({ role, user, pin }) {
    const isHR = role === 'hr';
    const url = isHR ? `${API_URL}/auth/hr/login` : `${API_URL}/auth/employee/login`;
    const payload = isHR ? { name: user, pin } : { id: user, pin };

    const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await jsonOrEmpty(res);
    if (!res.ok) throw new Error(data.error || 'Login failed');

    // Save in localStorage (works when served over http(s))
    // Also pass via URL hash on redirect (works even for file:// where storage can be isolated per file).
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

    return {
        role,
        token: data.token,
        hrName: data?.hr?.name || (isHR ? user : ''),
        employeeName: data?.employee?.name || (!isHR ? 'Employee' : ''),
        employeeId: data?.employee?.id || null
    };
}

async function registerUser({ role, name, pin }) {
    const isHr = role === 'hr';
    const url = isHr ? `${API_URL}/auth/hr/register` : `${API_URL}/auth/employee/register`;
    const payload = isHr ? { name, pin } : { name, pin };

    const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await jsonOrEmpty(res);
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
}

// Login form
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const role = String(document.getElementById('loginRole')?.value || 'employee');
    const user = String(document.getElementById('loginUser')?.value || '').trim();
    const pin = String(document.getElementById('loginPin')?.value || '').trim();

    if (!user || !pin) {
        setMessage(loginMessage, 'Enter your login and PIN.', 'error');
        return;
    }

    setMessage(loginMessage, 'Signing in...', 'info');
    try {
        const authPayload = await doLogin({ role, user, pin });
        setMessage(loginMessage, 'Login successful. Redirecting...', 'success');
        redirectToAppWithAuth(authPayload);
    } catch (err) {
        const raw = String(err?.message || 'Login failed');
        const isFetchFail = raw.toLowerCase().includes('failed to fetch');
        const isDevTunnel = String(API_URL || '').includes('devtunnels.ms');
        const isLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(API_URL || ''));
        const extra = isFetchFail
            ? (isDevTunnel
                ? ` Cannot reach API at ${API_URL}. This devtunnel looks protected (requires sign-in). In VS Code → Ports, set port 3000 visibility to Public, or open ${API_URL}/ui/ in this same browser and complete the GitHub sign-in, then retry.`
                : (isLocalApi
                    ? ` Cannot reach API at ${API_URL}. Make sure the backend is running. If you are opening the site from your phone, don't use localhost—open the Live Server URL with your PC Wi‑Fi IP (e.g. http://192.168.x.x:5500/...) so the API becomes http://192.168.x.x:3000.`
                    : ` Cannot reach API at ${API_URL}. Make sure port 3000 is forwarded and the backend is running.`))
            : '';
        setMessage(loginMessage, raw + extra, 'error');
    }
});

// Register form
const registerForm = document.getElementById('registerForm');
const registerMessage = document.getElementById('registerMessage');

registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const role = String(document.getElementById('regRole')?.value || 'employee');
    const name = String(document.getElementById('regName')?.value || '').trim();
    const pin = String(document.getElementById('regPin')?.value || '').trim();
    if (!name || !pin) {
        setMessage(registerMessage, 'Enter name and PIN.', 'error');
        return;
    }

    setMessage(registerMessage, 'Creating account...', 'info');
    try {
        const created = await registerUser({ role, name, pin });

        if (role === 'employee') {
            const createdId = created?.id;
            setMessage(registerMessage, `Account created. Your Employee ID is ${createdId}. Use it to sign in.`, 'success');
        } else {
            setMessage(registerMessage, 'Account created. You can sign in now.', 'success');
        }
        container?.classList.remove('active');
    } catch (err) {
        setMessage(registerMessage, err?.message || 'Registration failed', 'error');
    }
});

// Preselect role via query string
try {
    const params = new URLSearchParams(window.location.search || '');
    const role = params.get('role');
    const select = document.getElementById('loginRole');
    if (select && (role === 'hr' || role === 'employee')) {
        select.value = role;
    }

    const regSelect = document.getElementById('regRole');
    if (regSelect && (role === 'hr' || role === 'employee')) {
        regSelect.value = role;
    }
} catch {}