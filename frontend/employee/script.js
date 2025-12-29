// Derive API host from where the frontend is loaded.
// - Local dev: prefer localhost:3000 (avoids 127.0.0.1 port conflicts in some setups)
// - VS Code "Ports" / tunneling: hostnames often embed the port (e.g. <id>-5173.<domain>)
//   In that case, the backend forwarded port is usually <id>-3000.<domain> (no :3000).
const API_URL = (() => {
    try {
        const loc = window.location;
        const protocol = loc?.protocol || '';
        const hostname = (loc?.hostname || '').trim();

        const isHttp = protocol.startsWith('http');
        if (!isHttp) return 'http://localhost:3000';

        const isLocalHost = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
        if (isLocalHost) return 'http://localhost:3000';

        // VS Code ports can appear in a couple common hostname shapes:
        // - Suffix form: <name>-5173.<domain>  => <name>-3000.<domain>
        // - Prefix form: 5173-<name>.<domain>  => 3000-<name>.<domain>
        const suffix = hostname.match(/^(.*)-(\d+)(\..*)$/);
        if (suffix) {
            return `${protocol}//${suffix[1]}-3000${suffix[3]}`;
        }

        const prefix = hostname.match(/^(\d+)-(.*)$/);
        if (prefix) {
            return `${protocol}//3000-${prefix[2]}`;
        }

        // Default: same host, explicit backend port
        return `${protocol}//${hostname}:3000`;
    } catch {}

    return 'http://localhost:3000';
})();

const employeeForm = document.getElementById('employeeForm');
const employeesList = document.getElementById('employeesList');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');
const addEmployeeBtn = document.getElementById('addEmployeeBtn');
const refreshBtn = document.getElementById('refreshBtn');
const formPanel = document.getElementById('formPanel');
const formTitle = document.getElementById('formTitle');
const resetBtn = document.getElementById('resetBtn');
const profileModal = document.getElementById('profileModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const profileTitle = document.getElementById('profileTitle');
const profileDetails = document.getElementById('profileDetails');
const modalTaskForm = document.getElementById('modalTaskForm');
const modalStartBtn = document.getElementById('modalStartBtn');
const modalStopBtn = document.getElementById('modalStopBtn');
let editingId = null;
let viewingEmployeeId = null;
let currentTaskFilter = 'all';
let currentUserTasks = [];
let activeUserId = null;
let hrToken = localStorage.getItem('hrToken') || null;
let hrName = localStorage.getItem('hrName') || '';
let employeeToken = localStorage.getItem('employeeToken') || null;
let employeeName = localStorage.getItem('employeeName') || '';
let employeeId = localStorage.getItem('employeeId') ? Number(localStorage.getItem('employeeId')) : null;

function currentRole() {
    if (hrToken) return 'hr';
    if (employeeToken) return 'employee';
    return null;
}

function currentToken() {
    return hrToken || employeeToken || null;
}

function clearAuth() {
    hrToken = null;
    hrName = '';
    localStorage.removeItem('hrToken');
    localStorage.removeItem('hrName');

    employeeToken = null;
    employeeName = '';
    employeeId = null;
    localStorage.removeItem('employeeToken');
    localStorage.removeItem('employeeName');
    localStorage.removeItem('employeeId');
}

function updateAuthUI() {
    const statusEl = document.getElementById('authStatus');
    const employeeLoginBtn = document.getElementById('employeeLoginBtn');
    const hrLoginBtn = document.getElementById('hrLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    const role = currentRole();
    if (statusEl) {
        if (role === 'hr') statusEl.textContent = `HR: Logged in as ${hrName || 'HR'}`;
        else if (role === 'employee') statusEl.textContent = `Employee: Logged in as ${employeeName || 'Employee'}`;
        else statusEl.textContent = 'Not logged in';
    }

    const isAuthed = !!role;
    if (employeeLoginBtn) employeeLoginBtn.style.display = isAuthed ? 'none' : '';
    if (hrLoginBtn) hrLoginBtn.style.display = isAuthed ? 'none' : '';
    if (logoutBtn) logoutBtn.style.display = isAuthed ? '' : 'none';
}

async function hrLoginPrompt() {
    const name = prompt('Enter HR name');
    if (!name) return false;

    const pin = prompt('Enter HR PIN');
    if (!pin) return false;

    const res = await fetch(`${API_URL}/auth/hr/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin })
    });

    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'HR login failed');
        return false;
    }

    const data = await res.json();
    // Ensure only one session type at a time
    employeeToken = null;
    employeeName = '';
    employeeId = null;
    localStorage.removeItem('employeeToken');
    localStorage.removeItem('employeeName');
    localStorage.removeItem('employeeId');

    hrToken = data.token;
    localStorage.setItem('hrToken', hrToken);

    const gotName = (data && data.hr && data.hr.name) ? String(data.hr.name) : String(name);
    hrName = gotName;
    localStorage.setItem('hrName', hrName);
    return true;
}

async function employeeLoginPrompt() {
    const id = prompt('Enter Employee ID');
    if (!id) return false;
    const pin = prompt('Enter employee PIN');
    if (!pin) return false;

    const res = await fetch(`${API_URL}/auth/employee/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, pin })
    });

    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Employee login failed');
        return false;
    }

    const data = await res.json();
    // Ensure only one session type at a time
    hrToken = null;
    hrName = '';
    localStorage.removeItem('hrToken');
    localStorage.removeItem('hrName');

    employeeToken = data.token;
    localStorage.setItem('employeeToken', employeeToken);

    employeeName = (data && data.employee && data.employee.name) ? String(data.employee.name) : '';
    localStorage.setItem('employeeName', employeeName);

    employeeId = (data && data.employee && data.employee.id) ? Number(data.employee.id) : null;
    if (employeeId) localStorage.setItem('employeeId', String(employeeId));

    activeUserId = employeeId;
    return true;
}

function apiFetch(path, options = {}, requireHr = false) {
    const headers = { ...(options.headers || {}) };
    const token = currentToken();
    if (!token) throw new Error('Authentication required');
    if (requireHr && !hrToken) throw new Error('HR authentication required');
    headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API_URL}${path}`, { ...options, credentials: 'include', headers });
}

// ===== Requests (Employee) =====
function formatRequestType(t) {
    const s = String(t || '').toLowerCase();
    if (s === 'wfh') return 'WFH';
    if (s === 'leave') return 'Leave';
    if (s === 'overtime') return 'Overtime';
    return s || 'Request';
}

function renderMyRequests(data) {
    const el = document.getElementById('myRequestsList');
    if (!el) return;
    const rows = (data && data.rows) ? data.rows : [];
    if (!rows.length) {
        el.innerHTML = '<div class="muted">No requests yet.</div>';
        return;
    }

    el.innerHTML = `
        <div class="workload-table-wrap" style="margin-top:8px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead>
                    <tr>
                        <th>Created</th>
                        <th>Type</th>
                        <th>Dates</th>
                        <th>Status</th>
                        <th>HR Note</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const created = String(r.created_at || '');
                        const type = formatRequestType(r.type);
                        const dates = r.end_date ? `${r.start_date} → ${r.end_date}` : String(r.start_date || '');
                        const status = String(r.status || 'pending');
                        const note = r.hr_note ? String(r.hr_note) : '';
                        return `
                            <tr>
                                <td>${created}</td>
                                <td>${type}</td>
                                <td>${dates}</td>
                                <td><span class="pill">${status}</span></td>
                                <td>${note}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadMyRequests() {
    const box = document.getElementById('requestsBox');
    const el = document.getElementById('myRequestsList');
    if (!box || !el) return;

    if (!currentRole()) {
        el.innerHTML = '<div class="muted">Login to view requests.</div>';
        return;
    }
    if (currentRole() !== 'employee') {
        // Keep it simple: requests submission is employee-only.
        box.style.display = 'none';
        return;
    }
    box.style.display = '';

    const userId = activeUserId;
    if (!userId) {
        el.innerHTML = '<div class="muted">Login to view requests.</div>';
        return;
    }

    el.innerHTML = '<div class="muted">Loading requests...</div>';
    try {
        const res = await apiFetch(`/employees/${userId}/requests`);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load requests');
        }
        const data = await res.json();
        renderMyRequests(data);
    } catch (err) {
        el.innerHTML = `<div class="muted">${err.message || 'Failed to load requests'}</div>`;
    }
}

async function submitRequest(form) {
    const userId = activeUserId;
    if (!userId) {
        alert('Login required');
        return;
    }
    const payload = {
        type: form.type.value,
        start_date: form.start_date.value,
        end_date: form.end_date.value || null,
        reason: form.reason.value || ''
    };

    const res = await apiFetch(`/employees/${userId}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to submit request');
        return;
    }

    form.reset();
    await loadMyRequests();
    alert('Request submitted');
}

// ===== HR Requests Review =====
function renderRequestsReview(data) {
    const container = document.getElementById('requestsReview');
    if (!container) return;
    const rows = (data && data.rows) ? data.rows : [];
    if (!rows.length) {
        container.innerHTML = '<div class="muted">No requests found.</div>';
        return;
    }

    container.innerHTML = `
        <div class="workload-table-wrap" style="margin-top:8px;">
            <table class="workload-table" style="min-width: 920px;">
                <thead>
                    <tr>
                        <th>Created</th>
                        <th>Employee</th>
                        <th>Type</th>
                        <th>Dates</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const created = String(r.created_at || '');
                        const emp = `${String(r.employee_name || '')}`;
                        const type = formatRequestType(r.type);
                        const dates = r.end_date ? `${r.start_date} → ${r.end_date}` : String(r.start_date || '');
                        const status = String(r.status || 'pending');
                        const disable = status !== 'pending' ? 'disabled' : '';
                        return `
                            <tr>
                                <td>${created}</td>
                                <td>${emp}</td>
                                <td>${type}</td>
                                <td>${dates}</td>
                                <td><span class="pill">${status}</span></td>
                                <td>
                                    <button class="btn btn-secondary" ${disable} onclick="reviewRequest(${r.id}, 'approved')">Approve</button>
                                    <button class="btn btn-danger" ${disable} onclick="reviewRequest(${r.id}, 'rejected')">Reject</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="muted" style="padding-top:10px;">Approvals are HR-only.</div>
    `;
}

async function loadRequestsReview() {
    const container = document.getElementById('requestsReview');
    if (!container) return;

    if (currentRole() !== 'hr') {
        container.innerHTML = '<div class="muted">Login as HR to review requests.</div>';
        return;
    }

    container.innerHTML = '<div class="muted">Loading requests...</div>';
    try {
        const typeEl = document.getElementById('requestsReviewType');
        const type = typeEl ? String(typeEl.value || '').trim() : '';
        const qs = type ? `?status=pending&type=${encodeURIComponent(type)}` : '?status=pending';
        const res = await apiFetch(`/requests${qs}`, {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load requests');
        }
        const data = await res.json();
        renderRequestsReview(data);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'Failed to load requests'}</div>`;
    }
}

async function reviewRequest(requestId, status) {
    if (!confirm(`${status === 'approved' ? 'Approve' : 'Reject'} this request?`)) return;
    const note = prompt('Optional HR note (can be empty)') || '';

    const res = await apiFetch(`/requests/${requestId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, hr_note: note })
    }, true);

    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to review request');
        return;
    }

    await loadRequestsReview();
    await loadAuditLog();
}

// ===== Announcements =====
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAnnouncements(data) {
    const container = document.getElementById('announcementsList');
    if (!container) return;

    const rows = data && data.rows ? data.rows : [];
    if (!rows.length) {
        container.innerHTML = '<div class="muted">No announcements.</div>';
        return;
    }

    const isHR = currentRole() === 'hr';

    container.innerHTML = `
        <div class="workload-table-wrap" style="margin-top:8px;">
            <table class="workload-table" style="min-width: 920px;">
                <thead>
                    <tr>
                        <th>Created</th>
                        <th>Title</th>
                        <th>Message</th>
                        <th>Expires</th>
                        <th>By</th>
                        ${isHR ? '<th>Action</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(a => {
                        const created = escapeHtml(a.created_at || '');
                        const title = escapeHtml(a.title || '');
                        const msg = escapeHtml(a.message || '');
                        const exp = escapeHtml(a.expires_at || '');
                        const by = escapeHtml(a.created_by_hr_name || '');
                        return `
                            <tr>
                                <td>${created}</td>
                                <td>${title}</td>
                                <td>${msg}</td>
                                <td>${exp}</td>
                                <td>${by}</td>
                                ${isHR ? `
                                    <td>
                                        <button class="btn btn-secondary" onclick="editAnnouncement(${a.id})">Edit</button>
                                        <button class="btn btn-danger" onclick="deleteAnnouncement(${a.id})">Delete</button>
                                    </td>
                                ` : ''}
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadAnnouncements() {
    const container = document.getElementById('announcementsList');
    if (!container) return;

    if (!currentRole()) {
        container.innerHTML = '<div class="muted">Login to view announcements.</div>';
        return;
    }

    container.innerHTML = '<div class="muted">Loading announcements...</div>';
    try {
        const res = await apiFetch('/announcements?limit=20');
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load announcements');
        }
        const data = await res.json();
        renderAnnouncements(data);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'Failed to load announcements'}</div>`;
    }
}

async function createAnnouncement() {
    if (currentRole() !== 'hr') return;
    const titleEl = document.getElementById('announcementTitle');
    const msgEl = document.getElementById('announcementMessage');
    const expEl = document.getElementById('announcementExpires');
    if (!titleEl || !msgEl || !expEl) return;

    const payload = {
        title: titleEl.value.trim(),
        message: msgEl.value.trim(),
        expires_at: expEl.value ? expEl.value : null
    };

    const res = await apiFetch('/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, true);

    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to post announcement');
        return;
    }

    titleEl.value = '';
    msgEl.value = '';
    expEl.value = '';
    await loadAnnouncements();
    await loadAuditLog();
}

async function editAnnouncement(id) {
    if (currentRole() !== 'hr') return;
    const newTitle = (prompt('Title') || '').trim();
    if (!newTitle) return;
    const newMessage = (prompt('Message') || '').trim();
    if (!newMessage) return;
    const newExpires = (prompt('Expires (YYYY-MM-DD) or empty') || '').trim();

    const payload = {
        title: newTitle,
        message: newMessage,
        expires_at: newExpires ? newExpires : null
    };

    const res = await apiFetch(`/announcements/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, true);

    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to update announcement');
        return;
    }

    await loadAnnouncements();
    await loadAuditLog();
}

async function deleteAnnouncement(id) {
    if (currentRole() !== 'hr') return;
    if (!confirm('Delete this announcement?')) return;

    const res = await apiFetch(`/announcements/${id}`, { method: 'DELETE' }, true);
    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to delete announcement');
        return;
    }

    await loadAnnouncements();
    await loadAuditLog();
}

// ===== Streaks & Badges (Employee) =====
function renderGamification(payload) {
    const panel = document.getElementById('gamificationPanel');
    if (!panel) return;

    if (!payload) {
        panel.innerHTML = '<div class="muted">No data.</div>';
        return;
    }

    const streaks = payload.streaks || {};
    const stats = payload.stats || {};
    const badges = Array.isArray(payload.badges) ? payload.badges : [];

    const badgeRow = (b) => `
        <tr>
            <td>${escapeHtml(b.label || b.key || '')}</td>
            <td>${b.earned ? 'Earned' : 'Not yet'}</td>
        </tr>
    `;

    panel.innerHTML = `
        <div class="my-hours-grid">
            <div class="my-hours-item"><span class="label">Check-in streak:</span> <span>${Number(streaks.checkin_current || 0)} days</span></div>
            <div class="my-hours-item"><span class="label">On-time streak:</span> <span>${Number(streaks.ontime_current || 0)} days</span></div>
            <div class="my-hours-item"><span class="label">Check-in days:</span> <span>${Number(stats.checkin_days_total || 0)}</span></div>
            <div class="my-hours-item"><span class="label">On-time (7d):</span> <span>${Number(stats.ontime_days_last_7 || 0)}</span></div>
            <div class="my-hours-item"><span class="label">Tasks done:</span> <span>${Number(stats.tasks_done_total || 0)}</span></div>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Badges</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 640px;">
                <thead><tr><th>Badge</th><th>Status</th></tr></thead>
                <tbody>
                    ${badges.length ? badges.map(badgeRow).join('') : '<tr><td colspan="2" class="muted">No badges</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

async function loadGamification() {
    const panel = document.getElementById('gamificationPanel');
    if (!panel) return;

    if (currentRole() !== 'employee') {
        panel.innerHTML = '<div class="muted">Login as Employee to view streaks.</div>';
        return;
    }
    if (!activeUserId) {
        panel.innerHTML = '<div class="muted">Login required.</div>';
        return;
    }

    panel.innerHTML = '<div class="muted">Loading streaks...</div>';
    try {
        const res = await apiFetch(`/employees/${activeUserId}/gamification`);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            panel.innerHTML = `<div class="muted">${escapeHtml(msg.error || 'Failed to load')}</div>`;
            return;
        }
        const data = await res.json();
        renderGamification(data);
    } catch (err) {
        panel.innerHTML = `<div class="muted">${escapeHtml(err.message || 'Failed to load')}</div>`;
    }
}

// ===== Team Leaderboard (HR) =====
function renderLeaderboard(payload) {
    const box = document.getElementById('leaderboardBox');
    if (!box) return;

    const topStreaks = payload && Array.isArray(payload.top_streaks) ? payload.top_streaks : [];
    const topOnTime = payload && Array.isArray(payload.top_ontime_week) ? payload.top_ontime_week : [];
    const topTasks = payload && Array.isArray(payload.top_tasks_done_week) ? payload.top_tasks_done_week : [];

    const rowStreak = (r) => `
        <tr>
            <td>${escapeHtml(r.name || '')}</td>
            <td>${escapeHtml(r.department || '')}</td>
            <td>${Number(r.streak || 0)}</td>
        </tr>
    `;
    const rowOnTime = (r) => `
        <tr>
            <td>${escapeHtml(r.name || '')}</td>
            <td>${escapeHtml(r.department || '')}</td>
            <td>${Number(r.ontime_days_7d || 0)}</td>
            <td>${Number(r.checkin_days_7d || 0)}</td>
        </tr>
    `;
    const rowTasks = (r) => `
        <tr>
            <td>${escapeHtml(r.name || '')}</td>
            <td>${escapeHtml(r.department || '')}</td>
            <td>${Number(r.tasks_done_7d || 0)}</td>
        </tr>
    `;

    box.innerHTML = `
        <div class="muted" style="padding-top:6px; font-weight:700;">Top Streaks (today)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Dept</th><th>Streak</th></tr></thead>
                <tbody>${topStreaks.length ? topStreaks.map(rowStreak).join('') : '<tr><td colspan="3" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">On-time (last 7 days)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 780px;">
                <thead><tr><th>Employee</th><th>Dept</th><th>On-time days</th><th>Check-in days</th></tr></thead>
                <tbody>${topOnTime.length ? topOnTime.map(rowOnTime).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Tasks done (last 7 days)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Dept</th><th>Done</th></tr></thead>
                <tbody>${topTasks.length ? topTasks.map(rowTasks).join('') : '<tr><td colspan="3" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>
    `;
}

async function loadLeaderboard() {
    const box = document.getElementById('leaderboardBox');
    if (!box) return;

    if (currentRole() !== 'hr') {
        box.innerHTML = '<div class="muted">Login as HR to view leaderboard.</div>';
        return;
    }

    box.innerHTML = '<div class="muted">Loading leaderboard...</div>';
    try {
        const res = await apiFetch('/analytics/leaderboard', {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            box.innerHTML = `<div class="muted">${escapeHtml(msg.error || 'Failed to load leaderboard')}</div>`;
            return;
        }
        const data = await res.json();
        renderLeaderboard(data);
    } catch (err) {
        box.innerHTML = `<div class="muted">${escapeHtml(err.message || 'Failed to load leaderboard')}</div>`;
    }
}

// ===== HR Attention Needed =====
function renderAttention(payload) {
    const container = document.getElementById('attentionBox');
    if (!container) return;

    const summary = payload && payload.summary ? payload.summary : {};
    const overdue = payload && payload.overdue_tasks ? payload.overdue_tasks : [];
    const dueSoon = payload && payload.due_soon_tasks ? payload.due_soon_tasks : [];
    const pending = payload && payload.pending_requests ? payload.pending_requests : [];
    const noTime = payload && payload.no_recent_time_entries ? payload.no_recent_time_entries : [];
    const missingCheckout = payload && payload.missing_checkout ? payload.missing_checkout : [];
    const lateCheckins = payload && payload.late_checkins_today ? payload.late_checkins_today : [];
    const longShifts = payload && payload.long_shifts_last_7_days ? payload.long_shifts_last_7_days : [];

    const rowTask = (t) => `
        <tr>
            <td>${String(t.employee_name || '')}</td>
            <td>${String(t.title || '')}</td>
            <td>${String(t.priority || '')}</td>
            <td>${String(t.due_date || '')}</td>
        </tr>
    `;

    const rowReq = (r) => `
        <tr>
            <td>${String(r.employee_name || '')}</td>
            <td>${formatRequestType(r.type)}</td>
            <td>${r.end_date ? `${r.start_date} → ${r.end_date}` : String(r.start_date || '')}</td>
            <td>${String(r.created_at || '')}</td>
        </tr>
    `;

    const rowNoTime = (e) => `
        <tr>
            <td>${String(e.name || '')}</td>
            <td>${String(e.department || '')}</td>
            <td>${String(e.position || '')}</td>
            <td>${e.last_start_time ? String(e.last_start_time) : 'Never'}</td>
        </tr>
    `;

    const rowMissingCheckout = (r) => `
        <tr>
            <td>${String(r.employee_name || '')}</td>
            <td>${String(r.department || '')}</td>
            <td>${String(r.position || '')}</td>
            <td>${String(r.start_time || '')}</td>
        </tr>
    `;

    const rowLateCheckin = (r) => `
        <tr>
            <td>${String(r.name || '')}</td>
            <td>${String(r.department || '')}</td>
            <td>${String(r.position || '')}</td>
            <td>${String(r.first_start_time || '')}</td>
        </tr>
    `;

    const rowLongShift = (r) => {
        const secs = Number(r.duration_seconds || 0);
        const hours = secs ? (secs / 3600).toFixed(2) : '0.00';
        return `
            <tr>
                <td>${String(r.employee_name || '')}</td>
                <td>${String(r.department || '')}</td>
                <td>${String(r.position || '')}</td>
                <td>${String(r.start_time || '')}</td>
                <td>${String(r.end_time || '')}</td>
                <td>${hours}</td>
            </tr>
        `;
    };

    container.innerHTML = `
        <div class="workload-summary">
            <div class="muted">Overdue: ${Number(summary.overdue_tasks || 0)} • Due soon: ${Number(summary.due_soon_tasks || 0)} • Pending requests: ${Number(summary.pending_requests || 0)} • No time entries: ${Number(summary.no_recent_time_entries || 0)} • Late today: ${Number(summary.late_checkins_today || 0)} • Missing checkout: ${Number(summary.missing_checkout || 0)} • Long shifts (7d): ${Number(summary.long_shifts_last_7_days || 0)}</div>
        </div>

        <div class="muted" style="padding-top:8px; font-weight:700;">Overdue Tasks (top)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Task</th><th>Priority</th><th>Due</th></tr></thead>
                <tbody>${overdue.length ? overdue.map(rowTask).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Due Soon (≤ 3 days)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Task</th><th>Priority</th><th>Due</th></tr></thead>
                <tbody>${dueSoon.length ? dueSoon.map(rowTask).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Pending Requests</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Created</th></tr></thead>
                <tbody>${pending.length ? pending.map(rowReq).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">No Time Entries (last 3 days)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Department</th><th>Position</th><th>Last Start</th></tr></thead>
                <tbody>${noTime.length ? noTime.map(rowNoTime).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Attendance Anomalies</div>

        <div class="muted" style="padding-top:6px; font-weight:700;">Missing Checkout (open &gt; 12h)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Department</th><th>Position</th><th>Start</th></tr></thead>
                <tbody>${missingCheckout.length ? missingCheckout.map(rowMissingCheckout).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Late Check-ins Today (after 10:00)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead><tr><th>Employee</th><th>Department</th><th>Position</th><th>First Start</th></tr></thead>
                <tbody>${lateCheckins.length ? lateCheckins.map(rowLateCheckin).join('') : '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>

        <div class="muted" style="padding-top:10px; font-weight:700;">Long Shifts (last 7 days, ≥ 10h)</div>
        <div class="workload-table-wrap" style="margin-top:6px;">
            <table class="workload-table" style="min-width: 900px;">
                <thead><tr><th>Employee</th><th>Department</th><th>Position</th><th>Start</th><th>End</th><th>Hours</th></tr></thead>
                <tbody>${longShifts.length ? longShifts.map(rowLongShift).join('') : '<tr><td colspan="6" class="muted">None</td></tr>'}</tbody>
            </table>
        </div>
    `;
}

// ===== Leave Calendar =====
function toISODate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ensureDateRangeInputs(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    if (!fromEl.value || !toEl.value) {
        const now = new Date();
        const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (!fromEl.value) fromEl.value = toISODate(now);
        if (!toEl.value) toEl.value = toISODate(future);
    }
}

function renderLeaveCalendar(container, payload, showEmployeeCols) {
    if (!container) return;
    const rows = payload && payload.rows ? payload.rows : [];
    if (!rows.length) {
        container.innerHTML = '<div class="muted">No approved leave found for this range.</div>';
        return;
    }

    container.innerHTML = `
        <div class="workload-table-wrap" style="margin-top:8px;">
            <table class="workload-table" style="min-width: 820px;">
                <thead>
                    <tr>
                        ${showEmployeeCols ? '<th>Employee</th><th>Department</th>' : ''}
                        <th>Dates</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const emp = String(r.employee_name || '');
                        const dept = String(r.employee_department || '');
                        const dates = r.end_date ? `${r.start_date} → ${r.end_date}` : String(r.start_date || '');
                        const created = String(r.created_at || '');
                        return `
                            <tr>
                                ${showEmployeeCols ? `<td>${emp}</td><td>${dept}</td>` : ''}
                                <td>${dates}</td>
                                <td>${created}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadMyLeaveCalendar() {
    const container = document.getElementById('myLeaveList');
    if (!container) return;

    if (currentRole() !== 'employee') {
        container.innerHTML = '<div class="muted">Login as Employee to view approved leave.</div>';
        return;
    }

    const fromEl = document.getElementById('myLeaveFrom');
    const toEl = document.getElementById('myLeaveTo');
    ensureDateRangeInputs(fromEl, toEl);

    container.innerHTML = '<div class="muted">Loading approved leave...</div>';
    try {
        const qs = `?from=${encodeURIComponent(fromEl.value)}&to=${encodeURIComponent(toEl.value)}`;
        const res = await apiFetch(`/calendar/leave${qs}`);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load leave calendar');
        }
        const data = await res.json();
        renderLeaveCalendar(container, data, false);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'Failed to load leave calendar'}</div>`;
    }
}

async function loadTeamLeaveCalendar() {
    const container = document.getElementById('leaveCalendar');
    if (!container) return;

    if (currentRole() !== 'hr') {
        container.innerHTML = '<div class="muted">Login as HR to view team leave calendar.</div>';
        return;
    }

    const fromEl = document.getElementById('leaveCalFrom');
    const toEl = document.getElementById('leaveCalTo');
    ensureDateRangeInputs(fromEl, toEl);

    container.innerHTML = '<div class="muted">Loading team leave...</div>';
    try {
        const qs = `?from=${encodeURIComponent(fromEl.value)}&to=${encodeURIComponent(toEl.value)}`;
        const res = await apiFetch(`/calendar/leave${qs}`, {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load team leave calendar');
        }
        const data = await res.json();
        renderLeaveCalendar(container, data, true);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'Failed to load team leave calendar'}</div>`;
    }
}

async function loadTeamLeaveCalendarForAll() {
    const container = document.getElementById('teamLeaveList');
    if (!container) return;

    if (!currentRole()) {
        container.innerHTML = '<div class="muted">Login to view team leave calendar.</div>';
        return;
    }

    const fromEl = document.getElementById('teamLeaveFrom');
    const toEl = document.getElementById('teamLeaveTo');
    ensureDateRangeInputs(fromEl, toEl);

    container.innerHTML = '<div class="muted">Loading team leave...</div>';
    try {
        const qs = `?from=${encodeURIComponent(fromEl.value)}&to=${encodeURIComponent(toEl.value)}`;
        const res = await apiFetch(`/calendar/leave${qs}`);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load team leave calendar');
        }
        const data = await res.json();
        renderLeaveCalendar(container, data, true);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'Failed to load team leave calendar'}</div>`;
    }
}

async function loadAttention() {
    const container = document.getElementById('attentionBox');
    if (!container) return;

    if (currentRole() !== 'hr') {
        container.innerHTML = '<div class="muted">Login as HR to view attention inbox.</div>';
        return;
    }

    container.innerHTML = '<div class="muted">Loading attention inbox...</div>';
    try {
        const res = await apiFetch('/attention', {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load attention inbox');
        }
        const data = await res.json();
        renderAttention(data);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'Failed to load attention inbox'}</div>`;
    }
}

function nextStatus(current) {
    const statuses = { 'todo': 'doing', 'doing': 'done', 'done': 'todo' };
    return statuses[current] || 'todo';
}

function consumeAuthFromHash() {
    try {
        const hash = String(window.location.hash || '');
        if (!hash.startsWith('#auth=')) return;

        const encoded = hash.slice('#auth='.length);
        const payload = JSON.parse(decodeURIComponent(encoded));
        if (!payload || !payload.role || !payload.token) return;

        if (payload.role === 'hr') {
            employeeToken = null;
            employeeName = '';
            employeeId = null;
            localStorage.removeItem('employeeToken');
            localStorage.removeItem('employeeName');
            localStorage.removeItem('employeeId');

            hrToken = String(payload.token);
            hrName = String(payload.hrName || '');
            localStorage.setItem('hrToken', hrToken);
            localStorage.setItem('hrName', hrName);
        } else if (payload.role === 'employee') {
            hrToken = null;
            hrName = '';
            localStorage.removeItem('hrToken');
            localStorage.removeItem('hrName');

            employeeToken = String(payload.token);
            employeeName = String(payload.employeeName || 'Employee');
            employeeId = payload.employeeId != null ? Number(payload.employeeId) : null;

            localStorage.setItem('employeeToken', employeeToken);
            localStorage.setItem('employeeName', employeeName);
            if (employeeId != null && !Number.isNaN(employeeId)) {
                localStorage.setItem('employeeId', String(employeeId));
            } else {
                localStorage.removeItem('employeeId');
            }
        }

        // Clear hash to avoid leaking tokens in URLs / back button.
        try {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch {
            window.location.hash = '';
        }
    } catch {
        // ignore
    }
}

function applyTheme(mode) {
    const isDark = mode === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
}

function initializeThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    const saved = (localStorage.getItem('theme') || '').trim();
    const prefersDark = (() => {
        try {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch {
            return false;
        }
    })();

    const initialMode = saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light');
    applyTheme(initialMode);
    toggle.checked = initialMode === 'dark';

    toggle.addEventListener('change', () => {
        const mode = toggle.checked ? 'dark' : 'light';
        localStorage.setItem('theme', mode);
        applyTheme(mode);
    });
}

function applyInitialNavigationFromHash() {
    try {
        let raw = String(window.location.hash || '');
        const looksLikeAuth = raw.toLowerCase().startsWith('#auth=') || raw.toLowerCase().startsWith('#auth%3d');
        if (!raw || raw === '#' || looksLikeAuth) {
            try {
                const next = (sessionStorage.getItem('emsNextRoute') || '').trim();
                if (next) {
                    sessionStorage.removeItem('emsNextRoute');
                    raw = `#${next}`;
                }
            } catch {}
        }

        if (!raw || raw === '#') return;

        const hash = raw.replace(/^#/, '').trim();
        if (!hash) return;

        // Auth payload is handled by consumeAuthFromHash(); if it is still present here,
        // defer navigation until after auth is consumed.
        if (hash.toLowerCase().startsWith('auth=')) return;

        const route = hash.split(/[?&]/)[0].trim().toLowerCase();

        const clickIfExists = (el) => {
            if (el && typeof el.click === 'function') el.click();
        };

        if (route === 'directory' || route === 'tasks' || route === 'analytics') {
            const tab = document.querySelector(`.nav-tab[data-section="${route}"]`);
            clickIfExists(tab);
            return;
        }

        if (route === 'employer' || route === 'management') {
            clickIfExists(document.getElementById('employerProfileBtn'));
            return;
        }

        if (route === 'hours') {
            clickIfExists(document.getElementById('featureHours'));
            return;
        }

        if (route === 'task-management' || route === 'taskmanagement') {
            clickIfExists(document.getElementById('featureTasks'));
            return;
        }
    } catch {}
}

function consumeActionFromQuery() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const action = (params.get('action') || '').trim();
        if (!action) return;

        // Remove the action param so refresh doesn't re-trigger.
        try {
            params.delete('action');
            const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
            window.history.replaceState({}, '', next);
        } catch {}

        const click = (id) => document.getElementById(id)?.click();

        if (action === 'employee-login') return click('employeeLoginBtn');
        if (action === 'hr-login') return click('hrLoginBtn');
        if (action === 'add-employee') return click('addEmployeeBtn');
        if (action === 'logout') return click('logoutBtn');
    } catch {}
}

// Load employees on page load
document.addEventListener('DOMContentLoaded', () => {
    consumeAuthFromHash();
    initializeThemeToggle();
    initializeEventListeners();
    updateAuthUI();
    applyRoleUI();
    applyInitialNavigationFromHash();
    consumeActionFromQuery();
});

function initializeEventListeners() {
    const employeeLoginBtn = document.getElementById('employeeLoginBtn');
    const hrLoginBtn = document.getElementById('hrLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (employeeLoginBtn) {
        employeeLoginBtn.addEventListener('click', async () => {
            window.location.href = './login.html?role=employee';
        });
    }
    if (hrLoginBtn) {
        hrLoginBtn.addEventListener('click', async () => {
            window.location.href = './login.html?role=hr';
        });
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            clearAuth();
            activeUserId = null;
            updateAuthUI();
            applyRoleUI();
        });
    }

    // Employer profile (shows members list + lets you open member profiles)
    const employerProfileBtn = document.getElementById('employerProfileBtn');
    if (employerProfileBtn) {
        employerProfileBtn.addEventListener('click', () => {
            openEmployerProfile();
        });
    }

    // Feature tile: Employee Profiles (HR access to member list)
    const employeeProfilesBtn = document.getElementById('employeeProfilesBtn');
    if (employeeProfilesBtn) {
        const open = () => openEmployerProfile();
        employeeProfilesBtn.addEventListener('click', open);
        employeeProfilesBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    }

    // Navigation tabs
    function showSection(section, focus = null) {
        if (!currentRole()) {
            alert('Please login as Employee or HR to continue');
            return;
        }
        if (section === 'directory' && currentRole() !== 'hr') {
            alert('Login as HR to view Directory');
            section = 'tasks';
        }
        if (section === 'analytics' && currentRole() !== 'hr') {
            alert('Login as HR to view Analytics');
            section = 'tasks';
        }

        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));

        const tab = document.querySelector(`.nav-tab[data-section="${section}"]`);
        if (tab && tab.style.display !== 'none') tab.classList.add('active');

        const sectionEl = document.getElementById(`${section}-section`);
        if (sectionEl) sectionEl.classList.remove('hidden');

        if (section === 'tasks') {
            const headerTitle = document.getElementById('tasksHeaderTitle');
            const headerHint = document.getElementById('tasksHeaderHint');

            // Apply focused view if coming from feature tiles
            if (focus === 'hours') {
                // Show only hours tracking
                showTasksBoxes({ hours: true });
                if (headerTitle) headerTitle.textContent = '⏱️ Live Hours Tracking';
                if (headerHint) headerHint.textContent = 'Track only your working hours (start/stop and totals).';
                loadMyHours(activeUserId);
            } else if (focus === 'tasks') {
                // Show only task-related content
                showTasksBoxes({ tasks: true, filters: true });
                if (headerTitle) headerTitle.textContent = '✅ Task Management';
                if (headerHint) headerHint.textContent = 'Create, track, and complete tasks. Filter by status and priority.';
                loadMainTasks();
            } else {
                // Show all (from nav tab)
                showTasksBoxes({ all: true });
                if (headerTitle) headerTitle.textContent = '✅ My Tasks & Deadlines';
                if (headerHint) headerHint.textContent = 'Create, track, and complete your tasks. Filter by status and priority.';
                loadMainTasks();
                loadMyRequests();
                loadMyLeaveCalendar();
                loadTeamLeaveCalendarForAll();
                loadAnnouncements();
                loadGamification();
                if (currentRole() === 'employee' && activeUserId) loadWeeklyTimesheet(activeUserId);
            }
        }
        if (section === 'analytics') loadAnalytics();
    }

    function showTasksBoxes(opts = {}) {
        const boxes = {
            myHoursBox: document.getElementById('myHoursBox'),
            weeklyTimesheetBox: document.getElementById('weeklyTimesheetBox'),
            gamificationBox: document.getElementById('gamificationBox'),
            createTaskBox: document.querySelector('.task-creation-box:not([id])'),
            requestsBox: document.getElementById('requestsBox'),
            announcementsBox: document.getElementById('announcementsBox'),
            myLeaveBox: document.getElementById('myLeaveBox'),
            teamLeaveBox: document.getElementById('teamLeaveBox'),
            filtersRow: document.querySelector('.tasks-filters'),
            tasksDisplay: document.querySelector('.tasks-display')
        };

        if (opts.all) {
            // Show everything
            Object.values(boxes).forEach(el => { if (el) el.style.display = ''; });
        } else if (opts.hours) {
            // Show only hours
            if (boxes.myHoursBox) boxes.myHoursBox.style.display = '';
            if (boxes.weeklyTimesheetBox) boxes.weeklyTimesheetBox.style.display = 'none';
            if (boxes.gamificationBox) boxes.gamificationBox.style.display = 'none';
            if (boxes.createTaskBox) boxes.createTaskBox.style.display = 'none';
            if (boxes.requestsBox) boxes.requestsBox.style.display = 'none';
            if (boxes.announcementsBox) boxes.announcementsBox.style.display = 'none';
            if (boxes.myLeaveBox) boxes.myLeaveBox.style.display = 'none';
            if (boxes.teamLeaveBox) boxes.teamLeaveBox.style.display = 'none';
            if (boxes.filtersRow) boxes.filtersRow.style.display = 'none';
            if (boxes.tasksDisplay) boxes.tasksDisplay.style.display = 'none';
        } else if (opts.tasks) {
            // Show only task-related
            if (boxes.myHoursBox) boxes.myHoursBox.style.display = 'none';
            if (boxes.weeklyTimesheetBox) boxes.weeklyTimesheetBox.style.display = 'none';
            if (boxes.gamificationBox) boxes.gamificationBox.style.display = 'none';
            if (boxes.createTaskBox) boxes.createTaskBox.style.display = '';
            if (boxes.requestsBox) boxes.requestsBox.style.display = 'none';
            if (boxes.announcementsBox) boxes.announcementsBox.style.display = 'none';
            if (boxes.myLeaveBox) boxes.myLeaveBox.style.display = 'none';
            if (boxes.teamLeaveBox) boxes.teamLeaveBox.style.display = 'none';
            if (boxes.filtersRow) boxes.filtersRow.style.display = '';
            if (boxes.tasksDisplay) boxes.tasksDisplay.style.display = '';
        }
    }

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const section = e.currentTarget?.dataset?.section;
            // Nav tabs always show full view (no focus)
            if (section) showSection(section, null);
        });
    });

    const requestForm = document.getElementById('requestForm');
    if (requestForm) {
        requestForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitRequest(requestForm);
        });
    }

    const refreshRequestsBtn = document.getElementById('refreshRequestsBtn');
    if (refreshRequestsBtn) {
        refreshRequestsBtn.addEventListener('click', () => {
            loadMyRequests();
        });
    }

    const refreshRequestsReviewBtn = document.getElementById('refreshRequestsReviewBtn');
    if (refreshRequestsReviewBtn) {
        refreshRequestsReviewBtn.addEventListener('click', () => {
            loadRequestsReview();
        });
    }

    const requestsReviewType = document.getElementById('requestsReviewType');
    if (requestsReviewType) {
        requestsReviewType.addEventListener('change', () => {
            loadRequestsReview();
        });
    }

    const refreshMyLeaveBtn = document.getElementById('refreshMyLeaveBtn');
    if (refreshMyLeaveBtn) {
        refreshMyLeaveBtn.addEventListener('click', () => {
            loadMyLeaveCalendar();
        });
    }

    const refreshLeaveCalendarBtn = document.getElementById('refreshLeaveCalendarBtn');
    if (refreshLeaveCalendarBtn) {
        refreshLeaveCalendarBtn.addEventListener('click', () => {
            loadTeamLeaveCalendar();
        });
    }

    const refreshTeamLeaveBtn = document.getElementById('refreshTeamLeaveBtn');
    if (refreshTeamLeaveBtn) {
        refreshTeamLeaveBtn.addEventListener('click', () => {
            loadTeamLeaveCalendarForAll();
        });
    }

    const announcementForm = document.getElementById('announcementForm');
    if (announcementForm) {
        announcementForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createAnnouncement();
        });
    }

    const refreshAnnouncementsBtn = document.getElementById('refreshAnnouncementsBtn');
    if (refreshAnnouncementsBtn) {
        refreshAnnouncementsBtn.addEventListener('click', () => {
            loadAnnouncements();
        });
    }

    const refreshGamificationBtn = document.getElementById('refreshGamificationBtn');
    if (refreshGamificationBtn) {
        refreshGamificationBtn.addEventListener('click', () => {
            loadGamification();
        });
    }

    // Timesheets (Employee)
    const refreshTimesheetBtn = document.getElementById('refreshTimesheetBtn');
    if (refreshTimesheetBtn) {
        refreshTimesheetBtn.addEventListener('click', () => {
            if (!activeUserId) return;
            loadWeeklyTimesheet(activeUserId);
        });
    }
    const timesheetWeekStart = document.getElementById('timesheetWeekStart');
    if (timesheetWeekStart) {
        timesheetWeekStart.addEventListener('change', () => {
            if (!activeUserId) return;
            loadWeeklyTimesheet(activeUserId);
        });
    }
    const submitTimesheetBtn = document.getElementById('submitTimesheetBtn');
    if (submitTimesheetBtn) {
        submitTimesheetBtn.addEventListener('click', async () => {
            if (!activeUserId) return;
            await submitWeeklyTimesheet(activeUserId);
        });
    }

    // Timesheets (HR)
    const refreshTimesheetsReviewBtn = document.getElementById('refreshTimesheetsReviewBtn');
    if (refreshTimesheetsReviewBtn) {
        refreshTimesheetsReviewBtn.addEventListener('click', () => {
            loadTimesheetsReview();
        });
    }
    const timesheetsWeekStartHr = document.getElementById('timesheetsWeekStartHr');
    if (timesheetsWeekStartHr) {
        timesheetsWeekStartHr.addEventListener('change', () => {
            loadTimesheetsReview();
        });
    }
    const timesheetsStatusFilter = document.getElementById('timesheetsStatusFilter');
    if (timesheetsStatusFilter) {
        timesheetsStatusFilter.addEventListener('change', () => {
            loadTimesheetsReview();
        });
    }
    const downloadTimesheetsCsvBtn = document.getElementById('downloadTimesheetsCsvBtn');
    if (downloadTimesheetsCsvBtn) {
        downloadTimesheetsCsvBtn.addEventListener('click', () => {
            downloadTimesheetsCsv();
        });
    }

    // Feature tiles -> sections
    document.querySelectorAll('.feature-item[data-section]').forEach(tile => {
        const go = () => {
            // If an overlay modal is open, close it so navigation works as expected.
            try {
                if (profileModal && !profileModal.classList.contains('hidden')) {
                    closeProfile();
                }
            } catch {}
            const section = tile.dataset.section;
            const focus = tile.dataset.focus || null;
            if (section) showSection(section, focus);
        };
        tile.addEventListener('click', go);
        tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                go();
            }
        });
    });

    // Main task form submission
    const mainTaskForm = document.getElementById('mainTaskForm');
    if (mainTaskForm) {
        mainTaskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const title = form.title.value.trim();
            const description = form.description.value.trim();
            const status = form.status.value;
            const priority = form.priority.value;
            const dueDate = form.due_date.value;

            if (!title) {
                alert('Please enter a task title');
                return;
            }

            const userId = activeUserId;
            if (!userId) {
                alert('Please select a user first');
                return;
            }
            const payload = {
                title,
                description,
                status,
                priority,
                due_date: dueDate,
                task_type: 'personal'
            };

            try {
                const res = await apiFetch(`/employees/${userId}/tasks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const msg = await res.json().catch(() => ({}));
                    throw new Error(msg.error || 'Failed to create task');
                }
                form.reset();
                loadMainTasks();
            } catch (err) {
                alert('Error creating task: ' + err.message);
            }
        });
    }

    // Task filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const filter = e.target.dataset.filter;
            displayMainTasks(currentUserTasks, filter);
        });
    });

    // My Hours buttons (employee view)
    const myHoursStartBtn = document.getElementById('myHoursStartBtn');
    const myHoursStopBtn = document.getElementById('myHoursStopBtn');
    if (myHoursStartBtn) {
        myHoursStartBtn.addEventListener('click', async () => {
            if (!activeUserId) return alert('Please select a user first');
            await startTimer(activeUserId);
            await loadMyHours(activeUserId);
        });
    }
    if (myHoursStopBtn) {
        myHoursStopBtn.addEventListener('click', async () => {
            if (!activeUserId) return alert('Please select a user first');
            await stopTimer(activeUserId);
            await loadMyHours(activeUserId);
        });
    }
}

async function populateUserDropdown() {
    // With real auth, only HR can switch between employees.
    const userSelect = document.getElementById('userSelect');
    if (!userSelect) return;
    if (currentRole() !== 'hr') {
        userSelect.style.display = 'none';
        return;
    }

    userSelect.style.display = '';
    userSelect.innerHTML = '<option value="">Select employee...</option>';
    try {
        const res = await apiFetch('/employees', {}, true);
        if (!res.ok) throw new Error('Failed to load employees');
        const employees = await res.json();

        employees
            .slice()
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
            .forEach(emp => {
                const opt = document.createElement('option');
                opt.value = String(emp.id);
                opt.textContent = `${emp.name} (${emp.department || 'Dept'})`;
                userSelect.appendChild(opt);
            });

        // Default selection: first user if none
        if (!activeUserId && employees.length) {
            activeUserId = employees[0].id;
            userSelect.value = String(activeUserId);
        }
    } catch {
        // Keep dropdown usable even if backend is down
        userSelect.innerHTML = '<option value="">Backend not reachable</option>';
    }
}

function applyRoleUI() {
    const role = currentRole();
    const isHR = role === 'hr';
    const isEmployee = role === 'employee';

    updateAuthUI();

    const workloadEquityCard = document.getElementById('workloadEquityCard');
    if (workloadEquityCard) workloadEquityCard.style.display = isHR ? '' : 'none';

    const leaderboardCard = document.getElementById('leaderboardCard');
    if (leaderboardCard) leaderboardCard.style.display = isHR ? '' : 'none';

    const leaveCalendarCard = document.getElementById('leaveCalendarCard');
    if (leaveCalendarCard) leaveCalendarCard.style.display = isHR ? '' : 'none';

    const timesheetsReviewCard = document.getElementById('timesheetsReviewCard');
    if (timesheetsReviewCard) timesheetsReviewCard.style.display = isHR ? '' : 'none';

    const myLeaveBox = document.getElementById('myLeaveBox');
    if (myLeaveBox) myLeaveBox.style.display = isEmployee ? '' : 'none';

    const teamLeaveBox = document.getElementById('teamLeaveBox');
    if (teamLeaveBox) teamLeaveBox.style.display = role ? '' : 'none';

    const weeklyTimesheetBox = document.getElementById('weeklyTimesheetBox');
    if (weeklyTimesheetBox) weeklyTimesheetBox.style.display = isEmployee ? '' : 'none';

    const gamificationBox = document.getElementById('gamificationBox');
    if (gamificationBox) gamificationBox.style.display = isEmployee ? '' : 'none';

    const announcementHrControls = document.getElementById('announcementHrControls');
    if (announcementHrControls) announcementHrControls.style.display = isHR ? '' : 'none';

    // HR can add employees + use directory + analytics; employees focus on tasks/hours
    if (addEmployeeBtn) addEmployeeBtn.style.display = isHR ? '' : 'none';
    if (refreshBtn) refreshBtn.style.display = isHR ? '' : 'none';
    const employerProfileBtn = document.getElementById('employerProfileBtn');
    if (employerProfileBtn) employerProfileBtn.style.display = isHR ? '' : 'none';

    // Feature tiles: analytics is HR-only
    const featureAnalytics = document.getElementById('featureAnalytics');
    if (featureAnalytics) featureAnalytics.style.display = isHR ? '' : 'none';

    // Tabs: analytics is HR-only; directory visible when logged in
    document.querySelectorAll('.nav-tab').forEach(tab => {
        const section = tab.dataset.section;
        if (section === 'analytics') tab.style.display = isHR ? '' : 'none';
        if (section === 'directory') tab.style.display = isHR ? '' : 'none';
        if (section === 'tasks') tab.style.display = role ? '' : 'none';
    });

    // If not logged in, hide all sections and show a simple message
    if (!role) {
        document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));
        if (employeesList) employeesList.innerHTML = '<div class="no-employees">Please login as Employee or HR to continue.</div>';
        const tasksList = document.getElementById('mainTasksList');
        if (tasksList) tasksList.innerHTML = '<div class="muted">Please login to view tasks.</div>';
        return;
    }

    // If employee, force tasks section visible
    if (isEmployee) {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));
        const tasksTab = document.querySelector('.nav-tab[data-section="tasks"]');
        const tasksSection = document.getElementById('tasks-section');
        if (tasksTab) tasksTab.classList.add('active');
        if (tasksSection) tasksSection.classList.remove('hidden');
    }

    // HR defaults to Directory tab
    if (isHR) {
        const dirTab = document.querySelector('.nav-tab[data-section="directory"]');
        const dirSection = document.getElementById('directory-section');
        if (dirTab && dirSection) {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));
            dirTab.classList.add('active');
            dirSection.classList.remove('hidden');
        }
    }

    // Lock identity
    if (isEmployee) activeUserId = employeeId;

    if (isHR) {
        loadEmployees();
        populateUserDropdown();
    }
    if (activeUserId) {
        loadMainTasks();
        loadMyHours(activeUserId);
        if (isEmployee) {
            loadGamification();
            loadWeeklyTimesheet(activeUserId);
        }
    }
}

// ===== Timesheets (Weekly Timesheet + HR Review) =====
function weekStartMondayISO(dateStr) {
    const base = (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr))
        ? new Date(`${dateStr}T00:00:00`)
        : new Date();
    const day = base.getDay(); // 0 Sun .. 6 Sat
    const delta = (day + 6) % 7; // back to Monday
    base.setDate(base.getDate() - delta);
    return toISODate(base);
}

function formatHoursShort(sec) {
    const s = Math.max(0, Number(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
}

function statusLabelTimesheet(status) {
    const s = String(status || 'draft');
    if (s === 'draft') return 'Draft';
    if (s === 'submitted') return 'Submitted';
    if (s === 'approved') return 'Approved';
    if (s === 'rejected') return 'Rejected';
    return s;
}

const __timesheetNoteTimers = new Map();

async function loadWeeklyTimesheet(employeeId) {
    const container = document.getElementById('timesheetWeekTable');
    const statusPill = document.getElementById('timesheetStatusPill');
    const totalEl = document.getElementById('timesheetTotal');
    const openEl = document.getElementById('timesheetOpen');
    const weekInput = document.getElementById('timesheetWeekStart');
    const submitBtn = document.getElementById('submitTimesheetBtn');

    if (!container || !statusPill || !totalEl || !openEl || !weekInput) return;

    if (currentRole() !== 'employee') {
        statusPill.textContent = 'Employee only';
        totalEl.textContent = '--';
        openEl.textContent = '--';
        container.innerHTML = '<div class="muted">Login as Employee to view timesheet.</div>';
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    if (!weekInput.value) weekInput.value = weekStartMondayISO(toISODate(new Date()));
    const weekStart = weekStartMondayISO(weekInput.value);
    if (weekInput.value !== weekStart) weekInput.value = weekStart;

    container.innerHTML = '<div class="muted">Loading timesheet...</div>';
    statusPill.textContent = 'Loading...';
    totalEl.textContent = '--';
    openEl.textContent = '--';
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await apiFetch(`/employees/${employeeId}/timesheet/week?week_start=${encodeURIComponent(weekStart)}`);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load timesheet');
        }
        const data = await res.json();

        const days = Array.isArray(data.days) ? data.days : [];
        const totalSeconds = Number(data.total_seconds || 0);
        const openEntriesTotal = days.reduce((acc, d) => acc + Number(d.open_entries || 0), 0);

        statusPill.textContent = statusLabelTimesheet(data.status);
        totalEl.textContent = `${formatHoursShort(totalSeconds)} (${formatSeconds(totalSeconds)})`;
        openEl.textContent = String(openEntriesTotal);

        const st = String(data.status || 'draft');
        const canSubmit = (st === 'draft' || st === 'rejected');
        if (submitBtn) submitBtn.disabled = !canSubmit;

        const warn = openEntriesTotal > 0
            ? `<div class="muted" style="padding-bottom:8px;">Note: ${openEntriesTotal} open time entr${openEntriesTotal === 1 ? 'y' : 'ies'} found. Totals may be incomplete until you stop running timers.</div>`
            : '';

        container.innerHTML = `
            ${warn}
            <div class="workload-table-wrap" style="margin-top:0;">
                <table class="workload-table" style="min-width: 900px;">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Worked</th>
                            <th>Open</th>
                            <th style="min-width: 340px;">Daily Note</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${days.map(d => {
                            const day = escapeHtml(d.date || '');
                            const workedSeconds = Number(d.worked_seconds || 0);
                            const open = Number(d.open_entries || 0);
                            const note = escapeHtml(d.note || '');
                            return `
                                <tr>
                                    <td>${day}</td>
                                    <td>${formatHoursShort(workedSeconds)}</td>
                                    <td>${open > 0 ? `<span class="pill">${open}</span>` : '0'}</td>
                                    <td>
                                        <textarea class="timesheet-note" rows="2" data-work-date="${day}" aria-label="Timesheet note for ${day}" placeholder="Optional note...">${note}</textarea>
                                        <div class="muted timesheet-note-status" data-work-date="${day}"></div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <div class="muted" style="padding-top:10px;">Notes auto-save when you pause typing.</div>
        `;

        // Wire note autosave
        container.querySelectorAll('.timesheet-note').forEach((ta) => {
            ta.addEventListener('input', () => {
                const workDate = ta.dataset.workDate;
                const statusEl = container.querySelector(`.timesheet-note-status[data-work-date="${CSS.escape(workDate)}"]`);
                scheduleTimesheetNoteSave(employeeId, workDate, ta.value, statusEl);
            });
            ta.addEventListener('blur', () => {
                const workDate = ta.dataset.workDate;
                const statusEl = container.querySelector(`.timesheet-note-status[data-work-date="${CSS.escape(workDate)}"]`);
                scheduleTimesheetNoteSave(employeeId, workDate, ta.value, statusEl, 0);
            });
        });
    } catch (err) {
        statusPill.textContent = 'Error';
        container.innerHTML = `<div class="muted">${escapeHtml(err.message || 'Failed to load timesheet')}</div>`;
    }
}

function scheduleTimesheetNoteSave(employeeId, workDate, noteValue, statusEl, delayMs = 500) {
    if (!employeeId || !workDate) return;
    const key = `${employeeId}:${workDate}`;
    if (__timesheetNoteTimers.has(key)) {
        clearTimeout(__timesheetNoteTimers.get(key));
    }

    const doSave = async () => {
        if (statusEl) statusEl.textContent = 'Saving...';
        try {
            const res = await apiFetch(`/employees/${employeeId}/timesheet/note`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ work_date: workDate, note: String(noteValue || '') })
            });
            if (!res.ok) {
                const msg = await res.json().catch(() => ({}));
                throw new Error(msg.error || 'Failed to save note');
            }
            if (statusEl) {
                statusEl.textContent = 'Saved';
                setTimeout(() => {
                    if (statusEl.textContent === 'Saved') statusEl.textContent = '';
                }, 1500);
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = `Error: ${err.message || 'Failed'}`;
        }
    };

    const t = setTimeout(doSave, Math.max(0, Number(delayMs || 0)));
    __timesheetNoteTimers.set(key, t);
}

async function submitWeeklyTimesheet(employeeId) {
    const weekInput = document.getElementById('timesheetWeekStart');
    const statusPill = document.getElementById('timesheetStatusPill');
    if (!weekInput || !employeeId) return;

    if (currentRole() !== 'employee') {
        alert('Login as Employee to submit your timesheet.');
        return;
    }

    const weekStart = weekStartMondayISO(weekInput.value || toISODate(new Date()));
    const ok = confirm(`Submit your timesheet for week starting ${weekStart}?`);
    if (!ok) return;

    try {
        if (statusPill) statusPill.textContent = 'Submitting...';
        const res = await apiFetch(`/employees/${employeeId}/timesheet/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week_start: weekStart })
        });
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to submit timesheet');
        }
        await loadWeeklyTimesheet(employeeId);
        alert('Timesheet submitted for HR review.');
    } catch (err) {
        if (statusPill) statusPill.textContent = 'Error';
        alert(err.message || 'Failed to submit timesheet');
    }
}

async function loadTimesheetsReview() {
    const container = document.getElementById('timesheetsReview');
    const weekInput = document.getElementById('timesheetsWeekStartHr');
    const statusSel = document.getElementById('timesheetsStatusFilter');
    if (!container || !weekInput || !statusSel) return;

    if (currentRole() !== 'hr') {
        container.innerHTML = '<div class="muted">Login as HR to review timesheets.</div>';
        return;
    }

    if (!weekInput.value) weekInput.value = weekStartMondayISO(toISODate(new Date()));
    const wk = weekStartMondayISO(weekInput.value);
    if (weekInput.value !== wk) weekInput.value = wk;
    const status = String(statusSel.value || 'submitted');

    container.innerHTML = '<div class="muted">Loading timesheets...</div>';
    try {
        const qs = `?status=${encodeURIComponent(status)}&week_start=${encodeURIComponent(wk)}`;
        const res = await apiFetch(`/timesheets${qs}`, {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load timesheets');
        }
        const data = await res.json();
        const rows = data && Array.isArray(data.rows) ? data.rows : [];
        renderTimesheetsReview(container, rows, status);
    } catch (err) {
        container.innerHTML = `<div class="muted">${escapeHtml(err.message || 'Failed to load timesheets')}</div>`;
    }
}

function renderTimesheetsReview(container, rows, status) {
    if (!rows.length) {
        container.innerHTML = '<div class="muted">No timesheets found for this filter.</div>';
        return;
    }

    container.innerHTML = `
        <div class="workload-table-wrap" style="margin-top:8px;">
            <table class="workload-table" style="min-width: 1100px;">
                <thead>
                    <tr>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Week</th>
                        <th>Status</th>
                        <th>Total</th>
                        <th>Submitted</th>
                        <th>HR Note</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const id = Number(r.id);
                        const emp = escapeHtml(r.employee_name || '');
                        const dept = escapeHtml(r.employee_department || '');
                        const wk = escapeHtml(r.week_start || '');
                        const st = escapeHtml(r.status || '');
                        const submitted = escapeHtml(r.submitted_at || '');
                        const hrNote = escapeHtml(r.hr_note || '');
                        const totalSeconds = Number(r.total_seconds || 0);
                        const actions = (String(st) === 'submitted')
                            ? `
                                <div class="timesheet-actions">
                                    <input class="timesheet-hr-note" data-timesheet-id="${id}" type="text" placeholder="Optional note..." value="${hrNote}">
                                    <button type="button" class="btn btn-secondary timesheet-approve" data-timesheet-id="${id}">Approve</button>
                                    <button type="button" class="btn btn-outline timesheet-reject" data-timesheet-id="${id}">Reject</button>
                                </div>
                            `
                            : '<span class="muted">—</span>';
                        return `
                            <tr>
                                <td>${emp}</td>
                                <td>${dept}</td>
                                <td>${wk}</td>
                                <td><span class="pill">${st}</span></td>
                                <td>${formatHoursShort(totalSeconds)}</td>
                                <td>${submitted}</td>
                                <td>${hrNote || '<span class="muted">—</span>'}</td>
                                <td>${actions}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="muted" style="padding-top:10px;">Showing ${rows.length} timesheet(s) with status “${escapeHtml(status)}”.</div>
    `;

    container.querySelectorAll('.timesheet-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.timesheetId);
            const noteInput = container.querySelector(`.timesheet-hr-note[data-timesheet-id="${CSS.escape(String(id))}"]`);
            const note = noteInput ? noteInput.value : '';
            await decideTimesheet(id, 'approve', note);
        });
    });
    container.querySelectorAll('.timesheet-reject').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.timesheetId);
            const noteInput = container.querySelector(`.timesheet-hr-note[data-timesheet-id="${CSS.escape(String(id))}"]`);
            const note = noteInput ? noteInput.value : '';
            await decideTimesheet(id, 'reject', note);
        });
    });
}

async function decideTimesheet(timesheetId, decision, hrNote) {
    if (currentRole() !== 'hr') {
        alert('Login as HR to review timesheets.');
        return;
    }
    const label = decision === 'approve' ? 'Approve' : 'Reject';
    if (!confirm(`${label} this timesheet?`)) return;

    try {
        const res = await apiFetch(`/timesheets/${timesheetId}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, hr_note: hrNote || null })
        }, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to review timesheet');
        }
        await loadTimesheetsReview();
        await loadAuditLog();
    } catch (err) {
        alert(err.message || 'Failed to review timesheet');
    }
}

async function downloadTimesheetsCsv() {
    if (currentRole() !== 'hr') {
        alert('Login as HR to export payroll CSV.');
        return;
    }

    const weekInput = document.getElementById('timesheetsWeekStartHr');
    const statusSel = document.getElementById('timesheetsStatusFilter');
    if (!weekInput || !statusSel) return;

    const wk = weekStartMondayISO(weekInput.value || toISODate(new Date()));
    const status = String(statusSel.value || 'approved');

    try {
        const res = await apiFetch(`/timesheets/export.csv?week_start=${encodeURIComponent(wk)}&status=${encodeURIComponent(status)}`, {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to export CSV');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timesheets_${wk}_${status}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert(err.message || 'Failed to export CSV');
    }
}

function riskLevelForRow(row) {
    const open = Number(row.open_tasks || 0);
    const overdue = Number(row.overdue_tasks || 0);
    const dueSoon = Number(row.due_soon_tasks || 0);
    const weekHours = Number(row.week_seconds || 0) / 3600;

    if (overdue >= 2 || (overdue >= 1 && open >= 6) || weekHours >= 55) return 'high';
    if (overdue >= 1 || dueSoon >= 3 || open >= 8 || weekHours >= 45) return 'medium';
    return 'low';
}

function renderWorkloadEquity(payload) {
    const container = document.getElementById('workloadEquity');
    if (!container) return;

    const rows = (payload && Array.isArray(payload.rows)) ? payload.rows : [];
    if (!rows.length) {
        container.innerHTML = '<div class="muted">No employees found.</div>';
        return;
    }

    const high = rows.filter(r => riskLevelForRow(r) === 'high').length;
    const medium = rows.filter(r => riskLevelForRow(r) === 'medium').length;
    const low = rows.length - high - medium;

    const top = rows[0];
    const bottom = rows.slice().reverse().find(r => riskLevelForRow(r) !== 'high') || rows[rows.length - 1];
    const suggestion = (top && bottom && top.id !== bottom.id)
        ? `Suggestion: Consider shifting 1–2 tasks from ${top.name} to ${bottom.name}.`
        : 'Suggestion: Review overdue tasks first.';

    const updated = payload && payload.generated_at ? new Date(payload.generated_at) : null;
    const updatedText = updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleString() : '';

    container.innerHTML = `
        <div class="workload-summary">
            <div class="muted">Low: ${low} • Medium: ${medium} • High: ${high}</div>
            <div class="muted">${updatedText ? 'Updated: ' + updatedText : ''}</div>
        </div>
        <div class="workload-table-wrap">
            <table class="workload-table">
                <thead>
                    <tr>
                        <th>Employee</th>
                        <th>Open</th>
                        <th>Overdue</th>
                        <th>Due ≤ 3d</th>
                        <th>Week Hours</th>
                        <th>Risk</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const level = riskLevelForRow(r);
                        const weekHours = (Number(r.week_seconds || 0) / 3600);
                        const weekHoursText = (Math.round(weekHours * 10) / 10).toFixed(1);
                        return `
                            <tr>
                                <td>${r.name}</td>
                                <td>${Number(r.open_tasks || 0)}</td>
                                <td>${Number(r.overdue_tasks || 0)}</td>
                                <td>${Number(r.due_soon_tasks || 0)}</td>
                                <td>${weekHoursText}</td>
                                <td><span class="risk-pill risk-${level}">${level.toUpperCase()}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="muted" style="padding-top:10px;">${suggestion}</div>
        <div class="muted" style="padding-top:10px;">Admin actions (create HR users) are in Employer Profile.</div>
    `;
}

async function loadWorkloadEquity() {
    const container = document.getElementById('workloadEquity');
    if (!container) return;

    if (currentRole() !== 'hr') {
        container.innerHTML = '<div class="muted">Login as HR to view workload equity.</div>';
        return;
    }

    container.innerHTML = '<div class="muted">Loading workload equity...</div>';
    try {
        const res = await apiFetch('/analytics/workload', {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load workload equity');
        }
        const data = await res.json();
        renderWorkloadEquity(data);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'HR login required'}</div>`;
    }
}

function renderAuditLog(data) {
    const container = document.getElementById('auditLog');
    if (!container) return;

    const rows = (data && data.rows) ? data.rows : [];
    if (!rows.length) {
        container.innerHTML = '<div class="muted">No audit events yet.</div>';
        return;
    }

    const safe = (v) => (v === null || v === undefined) ? '' : String(v);

    container.innerHTML = `
        <div class="workload-table-wrap" style="margin-top:8px;">
            <table class="workload-table" style="min-width: 720px;">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Entity</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const when = safe(r.created_at);
                        const actor = (r.actor_role === 'hr') ? `HR: ${safe(r.actor_name)}` : `Employee: ${safe(r.actor_name)}`;
                        const action = safe(r.action);
                        const entity = `${safe(r.entity_type)}#${safe(r.entity_id)}`;
                        return `
                            <tr>
                                <td>${when}</td>
                                <td>${actor}</td>
                                <td>${action}</td>
                                <td>${entity}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="muted" style="padding-top:10px;">Shows recent HR and employee actions (HR-only).</div>
    `;
}

async function loadAuditLog() {
    const container = document.getElementById('auditLog');
    if (!container) return;

    if (currentRole() !== 'hr') {
        container.innerHTML = '<div class="muted">Login as HR to view audit log.</div>';
        return;
    }

    container.innerHTML = '<div class="muted">Loading audit log...</div>';
    try {
        const res = await apiFetch('/audit?limit=50', {}, true);
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            throw new Error(msg.error || 'Failed to load audit log');
        }
        const data = await res.json();
        renderAuditLog(data);
    } catch (err) {
        container.innerHTML = `<div class="muted">${err.message || 'HR login required'}</div>`;
    }
}

async function loadMyHours(employeeId) {
    const statusEl = document.getElementById('my-hours-status');
    const todayEl = document.getElementById('my-hours-today');
    const weekEl = document.getElementById('my-hours-week');
    const totalEl = document.getElementById('my-hours-total');
    if (!statusEl || !todayEl || !weekEl || !totalEl) return;

    statusEl.textContent = 'Loading...';
    try {
        const res = await apiFetch(`/employees/${employeeId}/time/summary`);
        if (!res.ok) throw new Error('Failed to load time');
        const data = await res.json();
        todayEl.textContent = formatSeconds(data.today_seconds);
        weekEl.textContent = formatSeconds(data.week_seconds);
        totalEl.textContent = formatSeconds(data.total_seconds);
        statusEl.textContent = data.running ? 'Running' : 'Stopped';
    } catch {
        statusEl.textContent = 'Error';
    }
}

// ===== Employer Profile =====
async function openEmployerProfile() {
    // Employer profile uses the same modal. Keep the Live Hours + Task panels available,
    // but require selecting a member (via "View Details") before actions work.
    const hoursTitle = document.getElementById('modalHoursTitle');
    const tasksTitle = document.getElementById('modalTasksTitle');
    const timeTracker = document.getElementById('modalTimeTracker');
    const taskManager = document.getElementById('modalTaskManager');
    if (hoursTitle) hoursTitle.style.display = '';
    if (tasksTitle) tasksTitle.style.display = '';
    if (timeTracker) timeTracker.style.display = '';
    if (taskManager) taskManager.style.display = '';

    // Reset selected member context
    viewingEmployeeId = null;
    try {
        const statusEl = document.getElementById('modal-status');
        const todayEl = document.getElementById('modal-today');
        const weekEl = document.getElementById('modal-week');
        const totalEl = document.getElementById('modal-total');
        if (statusEl) statusEl.textContent = 'Select a member';
        if (todayEl) todayEl.textContent = '--';
        if (weekEl) weekEl.textContent = '--';
        if (totalEl) totalEl.textContent = '--';
        const taskListEl = document.getElementById('modal-task-list');
        if (taskListEl) taskListEl.innerHTML = '<div class="muted">Select a member to view tasks.</div>';
    } catch {}

    // Wire actions to the currently selected member
    if (modalStartBtn) {
        modalStartBtn.onclick = () => {
            if (!viewingEmployeeId) {
                alert('Select a team member first (View Details).');
                return;
            }
            startModalTimer(viewingEmployeeId);
        };
    }
    if (modalStopBtn) {
        modalStopBtn.onclick = () => {
            if (!viewingEmployeeId) {
                alert('Select a team member first (View Details).');
                return;
            }
            stopModalTimer(viewingEmployeeId);
        };
    }
    if (modalTaskForm) {
        modalTaskForm.onsubmit = (e) => {
            if (!viewingEmployeeId) {
                e.preventDefault();
                alert('Select a team member first (View Details).');
                return false;
            }
            return addModalTask(e, viewingEmployeeId);
        };
    }

    profileTitle.textContent = '👔 Employer Profile';
    profileDetails.innerHTML = `
        <div class="detail-item">
            <strong>Role</strong>
            <span>Employer</span>
        </div>
        <div class="task-creation-box" id="hrUsersBox" style="margin-top:12px;">
            <h3>🔐 HR Users (Admin)</h3>
            <form id="createHrUserForm" class="main-task-form">
                <div class="form-row">
                    <input type="text" name="name" placeholder="HR name (e.g. HR2)" required>
                    <input type="password" name="pin" placeholder="PIN (min 4)" required>
                </div>
                <div class="form-row">
                    <button type="submit" class="btn btn-primary">Create HR User</button>
                </div>
            </form>
            <div id="hrUsersList" class="muted" style="padding-top:10px;">Loading HR users...</div>
        </div>
        <div class="detail-item">
            <strong>Team Members</strong>
            <span>Use “View Details” to manage hours and tasks</span>
        </div>
        <div class="task-creation-box" id="hrAssignBox" style="margin-top:12px;">
            <h3>🧑‍💼 Assign Task (HR)</h3>
            <form id="hrAssignForm" class="main-task-form">
                <div class="form-row">
                    <select name="employee_id" required>
                        <option value="">Select member...</option>
                    </select>
                    <input type="date" name="due_date">
                </div>
                <div class="form-row">
                    <input type="text" name="title" placeholder="Task title..." required>
                </div>
                <div class="form-row">
                    <textarea name="description" placeholder="Task description..." rows="2"></textarea>
                </div>
                <div class="form-row">
                    <select name="priority">
                        <option value="low">Low Priority</option>
                        <option value="medium" selected>Medium Priority</option>
                        <option value="high">High Priority</option>
                    </select>
                    <button type="submit" class="btn btn-primary">Assign</button>
                </div>
            </form>
        </div>
        <div id="employerMembersList" class="employees-grid"></div>
    `;

    profileModal.classList.remove('hidden');

    const membersEl = document.getElementById('employerMembersList');
    if (!membersEl) return;
    membersEl.innerHTML = '<div class="muted">Loading members...</div>';

    try {
        // Prefer backend filtered endpoint, fallback to all employees
        let res = await apiFetch('/team-members', {}, true);
        if (!res.ok) res = await apiFetch('/employees', {}, true);
        if (!res.ok) throw new Error('Failed to load members');
        let members = await res.json();

        // If the filtered endpoint returns OK but empty (common with older DBs), fallback to all
        if (Array.isArray(members) && members.length === 0) {
            const resAll = await fetch(`${API_URL}/employees`);
            if (resAll.ok) {
                const all = await resAll.json();
                if (Array.isArray(all) && all.length) members = all;
            }
        }

        // Populate assign form dropdown
        const hrUsersBox = document.getElementById('hrUsersBox');
        const createHrUserForm = document.getElementById('createHrUserForm');
        const hrUsersList = document.getElementById('hrUsersList');
        const assignBox = document.getElementById('hrAssignBox');
        const assignForm = document.getElementById('hrAssignForm');
        const assignSelect = assignForm?.querySelector('select[name="employee_id"]');

        if (hrUsersBox) {
            hrUsersBox.style.display = (currentRole() === 'hr') ? '' : 'none';
        }

        async function refreshHrUsersList() {
            if (!hrUsersList) return;
            if (currentRole() !== 'hr') {
                hrUsersList.innerHTML = '<div class="muted">Login as HR to manage HR users.</div>';
                return;
            }

            hrUsersList.textContent = 'Loading HR users...';
            try {
                const res = await apiFetch('/auth/hr/users', {}, true);
                if (!res.ok) {
                    const msg = await res.json().catch(() => ({}));
                    throw new Error(msg.error || 'Failed to load HR users');
                }
                const data = await res.json();
                const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
                // Privacy: do not display HR account names in the UI
                if (!rows.length) {
                    hrUsersList.innerHTML = '<div class="muted">No HR accounts found.</div>';
                    return;
                }
                hrUsersList.innerHTML = `<div class="muted">HR accounts are hidden for privacy. Total HR accounts: <strong>${rows.length}</strong></div>`;
            } catch (err) {
                hrUsersList.textContent = err.message || 'Failed to load HR users';
            }
        }

        await refreshHrUsersList();

        if (createHrUserForm) {
            createHrUserForm.onsubmit = async (e) => {
                e.preventDefault();
                if (currentRole() !== 'hr') return;

                const fd = new FormData(createHrUserForm);
                const name = String(fd.get('name') || '').trim();
                const pin = String(fd.get('pin') || '');
                if (!name || !pin) return;

                try {
                    const res = await apiFetch('/auth/hr/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, pin })
                    }, true);

                    if (!res.ok) {
                        const msg = await res.json().catch(() => ({}));
                        throw new Error(msg.error || 'Failed to create HR user');
                    }

                    createHrUserForm.reset();
                    alert(`HR user created: ${name}`);
                    await refreshHrUsersList();
                } catch (err) {
                    alert(err.message || 'Failed to create HR user');
                }
            };
        }

        if (assignBox) assignBox.style.display = (currentRole() === 'hr') ? '' : 'none';

        if (assignSelect) {
            members.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = String(emp.id);
                opt.textContent = emp.name;
                assignSelect.appendChild(opt);
            });
        }

        if (assignForm) {
            assignForm.onsubmit = async (e) => {
                e.preventDefault();
                if (currentRole() !== 'hr') return;
                const fd = new FormData(assignForm);
                const employeeId = fd.get('employee_id');
                const title = String(fd.get('title') || '').trim();
                if (!employeeId || !title) {
                    alert('Select member and enter a title');
                    return;
                }

                const payload = {
                    title,
                    description: String(fd.get('description') || ''),
                    priority: String(fd.get('priority') || 'medium'),
                    due_date: String(fd.get('due_date') || '') || null,
                    assigned_by: activeUserId || 1
                };

                let postRes;
                try {
                    postRes = await apiFetch(`/employees/${employeeId}/assign-task`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }, true);
                } catch (err) {
                    alert(err.message || 'HR authentication required');
                    return;
                }

                if (!postRes.ok) {
                    const msg = await postRes.json().catch(() => ({}));
                    if (postRes.status === 401 || postRes.status === 403) {
                        alert(msg.error || 'HR login required');
                        return;
                    }
                    alert(msg.error || 'Failed to assign task');
                    return;
                }

                assignForm.reset();
                alert('Task assigned');
            };
        }

        if (!Array.isArray(members) || members.length === 0) {
            membersEl.innerHTML = '<div class="muted">No members found</div>';
            return;
        }

        membersEl.innerHTML = members.map(emp => `
            <div class="employee-summary">
                <div class="employee-summary-info">
                    <div class="employee-summary-name">${emp.name}</div>
                    <div class="employee-summary-meta">
                        <span>${emp.position || ''}</span>
                        <span>${emp.department || ''}</span>
                    </div>
                </div>
                <div class="employee-summary-actions">
                    <button class="btn btn-view" onclick="openProfile(${emp.id})">👁️ View Details</button>
                </div>
            </div>
        `).join('');

        profileModal.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        membersEl.innerHTML = `<div class="muted">Error loading members: ${err.message}</div>`;
    }
}

if (addEmployeeBtn) {
    addEmployeeBtn.addEventListener('click', () => {
        formPanel.classList.remove('hidden');
        formPanel.scrollIntoView({ behavior: 'smooth' });
    });
}

if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadEmployees());
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeProfile);
}

// Form submission
employeeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const employee = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        position: document.getElementById('position').value,
        department: document.getElementById('department').value,
        salary: document.getElementById('salary').value
    };

    try {
        if (editingId) {
            await updateEmployee(editingId, employee);
        } else {
            await createEmployee(employee);
        }
        employeeForm.reset();
        resetForm();
        loadEmployees();
    } catch (error) {
        alert('Error: ' + error.message);
    }
});

// Cancel / close form
cancelBtn?.addEventListener('click', () => {
    formPanel.classList.add('hidden');
    resetForm();
});

// Alternative cancel button
document.getElementById('cancelBtn2')?.addEventListener('click', () => {
    formPanel.classList.add('hidden');
    resetForm();
});

// Reset form fields
resetBtn?.addEventListener('click', resetForm);

// Close modal when clicking X
// (Removed duplicate nav-tab handlers; handled in initializeEventListeners())
// Create employee
async function createEmployee(employee) {
    const response = await apiFetch(`/employees`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(employee)
    }, true);
    
    if (!response.ok) {
        const msg = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
            throw new Error(msg.error || 'HR login required');
        }
        throw new Error(msg.error || 'Failed to create employee');
    }
    
    return await response.json();
}

// ===== Time tracking =====
async function startTimer(employeeId) {
    const res = await apiFetch(`/employees/${employeeId}/time/start`, { method: 'POST' });
    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to start timer');
        return;
    }
    loadTimeSummary(employeeId);
}

async function stopTimer(employeeId) {
    const res = await apiFetch(`/employees/${employeeId}/time/stop`, { method: 'POST' });
    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to stop timer');
        return;
    }
    loadTimeSummary(employeeId);
}

function formatSeconds(sec) {
    const s = Math.max(0, Number(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return `${h}h ${m}m ${r}s`;
}

async function loadTimeSummary(employeeId) {
    const statusEl = document.getElementById(`status-${employeeId}`);
    const todayEl = document.getElementById(`today-${employeeId}`);
    const weekEl = document.getElementById(`week-${employeeId}`);
    const totalEl = document.getElementById(`total-${employeeId}`);
    if (!statusEl) return;

    statusEl.textContent = 'Loading...';

    try {
        const res = await apiFetch(`/employees/${employeeId}/time/summary`);
        if (!res.ok) throw new Error('Failed to load time');
        const data = await res.json();

        todayEl.textContent = formatSeconds(data.today_seconds);
        weekEl.textContent = formatSeconds(data.week_seconds);
        totalEl.textContent = formatSeconds(data.total_seconds);
        statusEl.textContent = data.running ? 'Running' : 'Stopped';
    } catch (err) {
        statusEl.textContent = 'Error';
    }
}

// ===== Tasks =====
async function loadTasks(employeeId) {
    const listEl = document.getElementById(`task-list-${employeeId}`);
    if (!listEl) return;
    listEl.innerHTML = '<div class="muted">Loading tasks...</div>';

    try {
        const res = await apiFetch(`/employees/${employeeId}/tasks`);
        if (!res.ok) throw new Error('Failed to load tasks');
        const tasks = await res.json();
        if (!tasks.length) {
            listEl.innerHTML = '<div class="muted">No tasks yet</div>';
            return;
        }
        listEl.innerHTML = tasks.map(t => taskRow(t)).join('');
    } catch (err) {
        listEl.innerHTML = '<div class="muted">Error loading tasks</div>';
    }
}

function taskRow(task) {
    const label = task.task_type === 'assigned' ? `<span class="assigned-label">From Team Lead</span>` : '';
    const assignedByText = task.assigned_by_name ? ` (by ${task.assigned_by_name})` : '';
    return `
    <div class="task-card" data-task="${task.id}" data-type="${task.task_type}">
        <div>
            <div>${task.title}${label}</div>
            <div class="task-meta">
                <span class="tag ${statusClass(task.status)}">${task.status}</span>
                <span class="tag priority-${task.priority}">Priority: ${task.priority}</span>
                ${task.due_date ? `<span class="muted">Due: ${task.due_date}</span>` : ''}
                ${assignedByText ? `<span class="muted">${assignedByText}</span>` : ''}
            </div>
        </div>
        <div class="task-actions">
            <button class="ghost" onclick="updateTask('${task.id}', { status: '${nextStatus(task.status)}' })">${nextStatusLabel(task.status)}</button>
            <button class="delete-btn" onclick="deleteTask('${task.id}', ${task.employee_id})">Delete</button>
        </div>
    </div>`;
}

function statusClass(status) {
    if (status === 'done') return 'done';
    if (status === 'doing') return 'doing';
    return 'todo';
}

function nextStatus(status) {
    if (status === 'todo') return 'doing';
    if (status === 'doing') return 'done';
    return 'todo';
}

function nextStatusLabel(status) {
    if (status === 'todo') return 'Start';
    if (status === 'doing') return 'Complete';
    return 'Reset';
}

async function addTask(event, employeeId) {
    event.preventDefault();
    const form = event.target;
    const title = form.title.value.trim();
    if (!title) return;

    const payload = {
        title,
        status: form.status.value,
        priority: form.priority.value,
        due_date: form.due_date.value || null,
    };

    const res = await apiFetch(`/employees/${employeeId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        alert('Failed to add task');
        return false;
    }

    form.reset();
    loadTasks(employeeId);
    return false;
}

async function updateTask(taskId, payload) {
    const res = await apiFetch(`/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        alert('Failed to update task');
        return;
    }

    // Find employee id from DOM
    const card = document.querySelector(`[data-task="${taskId}"]`);
    if (!card) return;
    const parent = card.closest('.task-manager');
    if (!parent) return;
    const employeeId = parent.id.replace('tasks-', '');
    loadTasks(employeeId);
}

async function deleteTask(taskId, employeeId) {
    const confirmDel = confirm('Delete this task?');
    if (!confirmDel) return;

    const res = await apiFetch(`/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok) {
        alert('Failed to delete task');
        return;
    }
    loadTasks(employeeId);
}

// ===== Profile Modal =====
async function openProfile(employeeId) {
    viewingEmployeeId = employeeId;

    // Switching back to employee profile mode: show employee-only panels again
    const hoursTitle = document.getElementById('modalHoursTitle');
    const tasksTitle = document.getElementById('modalTasksTitle');
    const timeTracker = document.getElementById('modalTimeTracker');
    const taskManager = document.getElementById('modalTaskManager');
    if (hoursTitle) hoursTitle.style.display = '';
    if (tasksTitle) tasksTitle.style.display = '';
    if (timeTracker) timeTracker.style.display = '';
    if (taskManager) taskManager.style.display = '';

    try {
        const res = await apiFetch(`/employees/${employeeId}`);
        if (!res.ok) throw new Error('Failed to load employee');
        const emp = await res.json();

        profileTitle.textContent = `${emp.name} - Profile`;
        profileDetails.innerHTML = `
            <div class="detail-item">
                <strong>Name</strong>
                <span>${emp.name}</span>
            </div>
            <div class="detail-item">
                <strong>Email</strong>
                <span>${emp.email}</span>
            </div>
            <div class="detail-item">
                <strong>Position</strong>
                <span>${emp.position}</span>
            </div>
            <div class="detail-item">
                <strong>Department</strong>
                <span>${emp.department}</span>
            </div>
            <div class="detail-item">
                <strong>Salary</strong>
                <span>$${parseFloat(emp.salary).toLocaleString()}</span>
            </div>
        `;

        profileModal.classList.remove('hidden');

        // Load time summary and tasks
        loadModalTimeSummary(employeeId);
        loadModalTasks(employeeId);

        // Set up modal event handlers
        modalStartBtn.onclick = () => startModalTimer(employeeId);
        modalStopBtn.onclick = () => stopModalTimer(employeeId);
        modalTaskForm.onsubmit = (e) => addModalTask(e, employeeId);

        // Set up task tab handlers (use onclick to avoid stacking duplicate listeners)
        document.querySelectorAll('.task-tab').forEach(tab => {
            tab.onclick = (e) => {
                document.querySelectorAll('.task-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentTaskFilter = e.target.dataset.tab;
                loadModalTasks(employeeId);
            };
        });

        profileModal.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        alert('Error loading profile: ' + err.message);
    }
}

function closeProfile() {
    profileModal.classList.add('hidden');
    viewingEmployeeId = null;
}

async function loadModalTimeSummary(employeeId) {
    const statusEl = document.getElementById('modal-status');
    const todayEl = document.getElementById('modal-today');
    const weekEl = document.getElementById('modal-week');
    const totalEl = document.getElementById('modal-total');

    statusEl.textContent = 'Loading...';

    try {
        const res = await apiFetch(`/employees/${employeeId}/time/summary`);
        if (!res.ok) throw new Error('Failed to load time');
        const data = await res.json();

        todayEl.textContent = formatSeconds(data.today_seconds);
        weekEl.textContent = formatSeconds(data.week_seconds);
        totalEl.textContent = formatSeconds(data.total_seconds);
        statusEl.textContent = data.running ? 'Running' : 'Stopped';
    } catch (err) {
        statusEl.textContent = 'Error';
    }
}

async function startModalTimer(employeeId) {
    const res = await apiFetch(`/employees/${employeeId}/time/start`, { method: 'POST' });
    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to start timer');
        return;
    }
    loadModalTimeSummary(employeeId);
}

async function stopModalTimer(employeeId) {
    const res = await apiFetch(`/employees/${employeeId}/time/stop`, { method: 'POST' });
    if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || 'Failed to stop timer');
        return;
    }
    loadModalTimeSummary(employeeId);
}

async function loadModalTasks(employeeId) {
    const listEl = document.getElementById('modal-task-list');
    listEl.innerHTML = '<div class="muted">Loading tasks...</div>';

    try {
        const res = await apiFetch(`/employees/${employeeId}/tasks`);
        if (!res.ok) throw new Error('Failed to load tasks');
        const tasks = await res.json();
        
        if (!tasks.length) {
            listEl.innerHTML = '<div class="muted">No tasks yet</div>';
            return;
        }

        // Filter tasks based on current tab
        let filteredTasks = tasks;
        if (currentTaskFilter === 'assigned') {
            filteredTasks = tasks.filter(t => t.task_type === 'assigned');
        } else if (currentTaskFilter === 'personal') {
            filteredTasks = tasks.filter(t => t.task_type === 'personal');
        }

        if (!filteredTasks.length) {
            listEl.innerHTML = `<div class="muted">No ${currentTaskFilter} tasks</div>`;
            return;
        }

        listEl.innerHTML = filteredTasks.map(t => taskRow(t)).join('');
    } catch (err) {
        listEl.innerHTML = '<div class="muted">Error loading tasks</div>';
    }
}

async function addModalTask(event, employeeId) {
    event.preventDefault();
    const form = event.target;
    const title = form.title.value.trim();
    if (!title) return;

    const payload = {
        title,
        status: form.status.value,
        priority: form.priority.value,
        due_date: form.due_date.value || null,
    };

    const res = await apiFetch(`/employees/${employeeId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        alert('Failed to add task');
        return false;
    }

    form.reset();
    loadModalTasks(employeeId);
    return false;
}

// ===== Main Tasks Management =====
async function loadMainTasks() {
    const userId = activeUserId;
    const listEl = document.getElementById('mainTasksList');
    if (!userId) {
        listEl.innerHTML = '<div class="muted">Select a user to view tasks.</div>';
        return;
    }
    listEl.innerHTML = '<div class="muted">Loading tasks...</div>';

    try {
        const res = await apiFetch(`/employees/${userId}/tasks`);
        if (!res.ok) throw new Error('Failed to load tasks');
        const tasks = await res.json();
        currentUserTasks = tasks;
        displayMainTasks(tasks, 'all');
    } catch (err) {
        listEl.innerHTML = '<div class="muted">Error loading tasks</div>';
    }
}

// Bootstrap role/user UI
// (bootstrapped in the earlier DOMContentLoaded)

function displayMainTasks(tasks, filter = 'all') {
    const listEl = document.getElementById('mainTasksList');
    
    let filtered = tasks;
    if (filter !== 'all') {
        filtered = tasks.filter(t => t.status === filter);
    }

    if (!filtered.length) {
        listEl.innerHTML = `<div class="muted">No ${filter === 'all' ? '' : filter} tasks found. Create one to get started!</div>`;
        return;
    }

    listEl.innerHTML = filtered.map(task => {
        const dueDate = new Date(task.due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let deadlineClass = '';
        let deadlineText = dueDate.toLocaleDateString();
        
        if (dueDate < today && task.status !== 'done') {
            deadlineClass = 'overdue';
            deadlineText += ' (OVERDUE)';
        } else if ((dueDate - today) / (1000 * 60 * 60 * 24) <= 3 && task.status !== 'done') {
            deadlineClass = 'urgent';
            deadlineText += ' (Soon)';
        }

        const cardClass = task.priority === 'high' ? 'urgent' : task.priority === 'medium' ? 'important' : 'normal';

        return `
        <div class="main-task-card ${cardClass}" data-task="${task.id}">
            <div class="task-card-header">
                <div class="task-card-title">${task.title}</div>
                <span class="task-card-status ${task.status}">${task.status}</span>
            </div>
            ${task.description ? `<div class="task-card-description">${task.description}</div>` : ''}
            <div class="task-card-meta">
                <div class="task-deadline ${deadlineClass}">${deadlineText}</div>
                <span class="task-priority ${task.priority}">Priority: ${task.priority}</span>
            </div>
            <div class="task-card-actions">
                <button class="btn btn-secondary" onclick="updateMainTask('${task.id}', { status: '${nextStatus(task.status)}' })">
                    ${task.status === 'todo' ? '▶️ Start' : task.status === 'doing' ? '✅ Complete' : '↩️ Reopen'}
                </button>
                <button class="btn btn-danger" onclick="deleteMainTask('${task.id}')">🗑️ Delete</button>
            </div>
        </div>`;
    }).join('');
}

async function updateMainTask(taskId, payload) {
    const res = await apiFetch(`/tasks/${taskId}` , {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        alert('Failed to update task');
        return;
    }
    loadMainTasks();
}

async function deleteMainTask(taskId) {
    if (!confirm('Delete this task?')) return;

    const res = await apiFetch(`/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok) {
        alert('Failed to delete task');
        return;
    }
    loadMainTasks();
}

// ===== Analytics =====
async function loadAnalytics() {
    const userId = activeUserId;

    if (!userId) {
        try {
            document.getElementById('stat-completed').textContent = '0';
            document.getElementById('stat-doing').textContent = '0';
            document.getElementById('stat-total').textContent = '0';
            document.getElementById('stat-hours').textContent = '0h';
            document.getElementById('chart-todo').textContent = '0';
            document.getElementById('chart-doing').textContent = '0';
            document.getElementById('chart-done').textContent = '0';
            document.getElementById('chart-high').textContent = '0';
            document.getElementById('chart-medium').textContent = '0';
            document.getElementById('chart-low').textContent = '0';
        } catch {}
        await loadWorkloadEquity();
        await loadLeaderboard();
        await loadAttention();
        await loadRequestsReview();
        await loadTimesheetsReview();
        await loadTeamLeaveCalendar();
        await loadAuditLog();
        return;
    }
    
    try {
        const tasksRes = await apiFetch(`/employees/${userId}/tasks`);
        const tasks = await tasksRes.json();

        const timeRes = await apiFetch(`/employees/${userId}/time/summary`);
        const timeData = await timeRes.json();

        const completed = tasks.filter(t => t.status === 'done').length;
        const doing = tasks.filter(t => t.status === 'doing').length;
        const total = tasks.length;
        const hours = Math.floor(timeData.total_seconds / 3600);

        document.getElementById('stat-completed').textContent = completed;
        document.getElementById('stat-doing').textContent = doing;
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-hours').textContent = hours + 'h';

        document.getElementById('chart-todo').textContent = tasks.filter(t => t.status === 'todo').length;
        document.getElementById('chart-doing').textContent = doing;
        document.getElementById('chart-done').textContent = completed;

        document.getElementById('chart-high').textContent = tasks.filter(t => t.priority === 'high').length;
        document.getElementById('chart-medium').textContent = tasks.filter(t => t.priority === 'medium').length;
        document.getElementById('chart-low').textContent = tasks.filter(t => t.priority === 'low').length;

        await loadWorkloadEquity();
        await loadLeaderboard();
        await loadAttention();
        await loadRequestsReview();
        await loadTimesheetsReview();
        await loadTeamLeaveCalendar();
        await loadAuditLog();
    } catch (err) {
        console.error('Failed to load analytics:', err);
    }
}

// Load all employees
async function loadEmployees() {
    try {
        const response = await apiFetch('/employees', {}, true);
        if (!response.ok) {
            throw new Error('Failed to load employees');
        }
        
        const employees = await response.json();
        displayEmployees(employees);
    } catch (error) {
        employeesList.innerHTML = '<div class="no-employees">Error loading employees. Make sure the backend server is running.</div>';
    }
}

// Display employees
function displayEmployees(employees) {
    if (employees.length === 0) {
        employeesList.innerHTML = '<div class="no-employees">No employees found. Add your first employee!</div>';
        return;
    }

    const isHR = currentRole() === 'hr';

    employeesList.innerHTML = employees.map(emp => `
        <div class="employee-summary">
            <div class="employee-summary-info">
                <div class="employee-summary-name">${emp.name}</div>
                <div class="employee-summary-meta">
                    <span>${emp.position}</span>
                    <span>${emp.department}</span>
                    <span>$${parseFloat(emp.salary).toLocaleString()}</span>
                </div>
            </div>
            <div class="employee-summary-actions">
                <button class="btn btn-view" onclick="openProfile(${emp.id})">👁️ View Profile</button>
                ${isHR ? `<button class="btn btn-edit" onclick="editEmployee(${emp.id})">✏️ Edit</button>` : ''}
                ${isHR ? `<button class="btn btn-delete" onclick="deleteEmployee(${emp.id})">🗑️ Delete</button>` : ''}
            </div>
        </div>
    `).join('');
}

// Edit employee
async function editEmployee(id) {
    try {
        const response = await fetch(`${API_URL}/employees/${id}`);
        if (!response.ok) {
            throw new Error('Failed to load employee');
        }
        
        const employee = await response.json();
        
        document.getElementById('name').value = employee.name;
        document.getElementById('email').value = employee.email;
        document.getElementById('position').value = employee.position;
        document.getElementById('department').value = employee.department;
        document.getElementById('salary').value = employee.salary;
        
        editingId = id;
        submitBtn.textContent = 'Update Employee';
        formTitle.textContent = 'Edit Employee';
        formPanel.classList.remove('hidden');
        formPanel.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Update employee
async function updateEmployee(id, employee) {
    const response = await apiFetch(`/employees/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(employee)
    }, true);
    
    if (!response.ok) {
        const msg = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
            throw new Error(msg.error || 'HR login required');
        }
        throw new Error(msg.error || 'Failed to update employee');
    }
    
    return await response.json();
}

// Delete employee
async function deleteEmployee(id) {
    if (!confirm('Are you sure you want to delete this employee?')) {
        return;
    }
    
    try {
        const response = await apiFetch(`/employees/${id}`, {
            method: 'DELETE'
        }, true);
        
        if (!response.ok) {
            const msg = await response.json().catch(() => ({}));
            if (response.status === 401 || response.status === 403) {
                throw new Error(msg.error || 'HR login required');
            }
            throw new Error(msg.error || 'Failed to delete employee');
        }
        
        loadEmployees();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Reset form
function resetForm() {
    editingId = null;
    submitBtn.textContent = 'Add Employee';
    formTitle.textContent = 'Add Employee';
    employeeForm.reset();
}
