require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const db = new sqlite3.Database(process.env.DATABASE_PATH || './employee.db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Serve frontend from the backend so you can deploy a single Render service.
const uiDir = path.join(__dirname, '..', 'frontend', 'employee');
app.use('/ui', express.static(uiDir));
app.get('/ui', (req, res) => res.redirect('/ui/'));
app.get('/ui/', (req, res) => res.sendFile(path.join(uiDir, 'index.html')));

function nowIso() {
  return new Date().toISOString();
}

function pbkdf2Hash(pin, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(String(pin || ''), s, 120000, 32, 'sha256').toString('hex');
  return { salt: s, hash: derived };
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function parseAuth(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    return jwt.verify(m[1], JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = parseAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function requireHr(req, res, next) {
  const user = parseAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'hr') return res.status(403).json({ error: 'HR only' });
  req.user = user;
  next();
}

function isSelfOrHr(reqUser, employeeId) {
  if (!reqUser) return false;
  if (reqUser.role === 'hr') return true;
  if (reqUser.role === 'employee' && Number(reqUser.employeeId) === Number(employeeId)) return true;
  return false;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS hr_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      position TEXT,
      department TEXT,
      salary INTEGER,
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      task_type TEXT NOT NULL DEFAULT 'personal',
      assigned_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      start_ts TEXT NOT NULL,
      end_ts TEXT,
      work_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS timesheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      hr_note TEXT,
      submitted_at TEXT,
      decided_at TEXT,
      UNIQUE(employee_id, week_start),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS timesheet_notes (
      employee_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      note TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(employee_id, work_date),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      hr_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by_name TEXT,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_name TEXT
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_role TEXT,
      actor_name TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // Default HR account (so you can log in immediately)
  const admin = await dbGet('SELECT id FROM hr_users WHERE name = ?', ['Admin']);
  if (!admin) {
    const { salt, hash } = pbkdf2Hash('1234');
    await dbRun(
      'INSERT INTO hr_users (name, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?)',
      ['Admin', salt, hash, nowIso()]
    );
  }
}

function auditLog(req, action, entity, entityId) {
  try {
    const u = req.user || null;
    const actorRole = u ? String(u.role || '') : '';
    const actorName = u ? String(u.name || '') : '';
    dbRun(
      'INSERT INTO audit (actor_role, actor_name, action, entity, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [actorRole, actorName, String(action || ''), String(entity || ''), entityId ? Number(entityId) : null, nowIso()]
    ).catch(() => {});
  } catch {}
}

// Basic test route
app.get('/', (req, res) => {
  res.send('Employee Management API is running');
});

// ===== Auth =====
app.post('/auth/hr/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!name || !pin || pin.length < 4) return res.status(400).json({ error: 'Invalid name or PIN' });
    const exists = await dbGet('SELECT id FROM hr_users WHERE name = ?', [name]);
    if (exists) return res.status(409).json({ error: 'HR user already exists' });
    const { salt, hash } = pbkdf2Hash(pin);
    const r = await dbRun(
      'INSERT INTO hr_users (name, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?)',
      [name, salt, hash, nowIso()]
    );
    return res.json({ id: r.lastID, name });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to register HR user' });
  }
});

app.post('/auth/hr/login', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!name || !pin) return res.status(400).json({ error: 'Missing credentials' });
    const hr = await dbGet('SELECT id, name, pin_salt, pin_hash FROM hr_users WHERE name = ?', [name]);
    if (!hr) return res.status(401).json({ error: 'Invalid credentials' });
    const chk = pbkdf2Hash(pin, hr.pin_salt);
    if (chk.hash !== hr.pin_hash) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ role: 'hr', hrId: hr.id, name: hr.name });
    return res.json({ token, hr: { id: hr.id, name: hr.name } });
  } catch {
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/auth/hr/users', requireHr, async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, name, created_at FROM hr_users ORDER BY id DESC');
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load HR users' });
  }
});

app.post('/auth/hr/users', requireHr, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!name || !pin || pin.length < 4) return res.status(400).json({ error: 'Invalid name or PIN' });
    const exists = await dbGet('SELECT id FROM hr_users WHERE name = ?', [name]);
    if (exists) return res.status(409).json({ error: 'HR user already exists' });
    const { salt, hash } = pbkdf2Hash(pin);
    const r = await dbRun(
      'INSERT INTO hr_users (name, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?)',
      [name, salt, hash, nowIso()]
    );
    auditLog(req, 'create', 'hr_user', r.lastID);
    return res.json({ id: r.lastID, name });
  } catch {
    return res.status(500).json({ error: 'Failed to create HR user' });
  }
});

app.post('/auth/employee/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!name || !pin || pin.length < 4) return res.status(400).json({ error: 'Invalid name or PIN' });
    const { salt, hash } = pbkdf2Hash(pin);
    const r = await dbRun(
      'INSERT INTO employees (name, email, position, department, salary, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, null, null, null, null, salt, hash, nowIso()]
    );
    return res.json({ id: r.lastID, name });
  } catch {
    return res.status(500).json({ error: 'Failed to register employee' });
  }
});

app.post('/auth/employee/login', async (req, res) => {
  try {
    // Accept both the current contract ({ id, pin }) and a legacy contract ({ email, pin })
    // where `email` may actually contain an ID string.
    const rawId = (req.body && (req.body.id ?? req.body.email)) ?? '';
    const id = Number.parseInt(String(rawId).trim(), 10);
    const pin = String(req.body?.pin || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !pin) return res.status(400).json({ error: 'Missing credentials' });
    const emp = await dbGet('SELECT id, name, pin_salt, pin_hash FROM employees WHERE id = ?', [id]);
    if (!emp) return res.status(401).json({ error: 'Invalid credentials' });
    const chk = pbkdf2Hash(pin, emp.pin_salt);
    if (chk.hash !== emp.pin_hash) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ role: 'employee', employeeId: emp.id, name: emp.name });
    return res.json({ token, employee: { id: emp.id, name: emp.name } });
  } catch {
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ===== Employees =====
app.get('/employees', async (req, res) => {
  try {
    const u = parseAuth(req);
    const isHr = u && u.role === 'hr';
    const cols = isHr
      ? 'id, name, email, position, department, salary, created_at'
      : 'id, name, email, position, department, created_at';
    const rows = await dbAll(`SELECT ${cols} FROM employees ORDER BY id DESC`);
    return res.json(rows);
  } catch {
    return res.status(500).json({ error: 'Failed to load employees' });
  }
});

app.get('/team-members', requireHr, async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, name, email, position, department, salary, created_at FROM employees ORDER BY id DESC');
    return res.json(rows);
  } catch {
    return res.status(500).json({ error: 'Failed to load team members' });
  }
});

app.get('/employees/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await dbGet('SELECT id, name, email, position, department, salary, created_at FROM employees WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch {
    return res.status(500).json({ error: 'Failed to load employee' });
  }
});

app.post('/employees', requireHr, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const position = String(req.body?.position || '').trim();
    const department = String(req.body?.department || '').trim();
    const salary = Number(req.body?.salary);
    if (!name || !email || !position || !department || !Number.isFinite(salary)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Default PIN for HR-created employees (employee can also self-register to set their own PIN)
    const { salt, hash } = pbkdf2Hash('1234');
    const r = await dbRun(
      'INSERT INTO employees (name, email, position, department, salary, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, position, department, salary, salt, hash, nowIso()]
    );
    auditLog(req, 'create', 'employee', r.lastID);
    return res.json({ id: r.lastID, name, email, position, department, salary, default_pin: '1234' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create employee' });
  }
});

app.put('/employees/:id', requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const position = String(req.body?.position || '').trim();
    const department = String(req.body?.department || '').trim();
    const salary = Number(req.body?.salary);
    if (!name || !email || !position || !department || !Number.isFinite(salary)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const r = await dbRun(
      'UPDATE employees SET name = ?, email = ?, position = ?, department = ?, salary = ? WHERE id = ?',
      [name, email, position, department, salary, id]
    );
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    auditLog(req, 'update', 'employee', id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to update employee' });
  }
});

app.delete('/employees/:id', requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await dbRun('DELETE FROM tasks WHERE employee_id = ?', [id]);
    await dbRun('DELETE FROM time_entries WHERE employee_id = ?', [id]);
    await dbRun('DELETE FROM timesheets WHERE employee_id = ?', [id]);
    await dbRun('DELETE FROM timesheet_notes WHERE employee_id = ?', [id]);
    await dbRun('DELETE FROM requests WHERE employee_id = ?', [id]);
    const r = await dbRun('DELETE FROM employees WHERE id = ?', [id]);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    auditLog(req, 'delete', 'employee', id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// ===== Tasks =====
app.get('/employees/:id/tasks', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const rows = await dbAll(
      'SELECT id, employee_id, title, description, status, priority, due_date, task_type, assigned_by_name FROM tasks WHERE employee_id = ? ORDER BY id DESC',
      [employeeId]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ error: 'Failed to load tasks' });
  }
});

app.post('/employees/:id/tasks', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const priority = String(req.body?.priority || 'medium').trim();
    const dueDate = req.body?.due_date ? String(req.body.due_date) : null;
    const taskType = String(req.body?.task_type || 'personal');
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const ts = nowIso();
    const r = await dbRun(
      'INSERT INTO tasks (employee_id, title, description, status, priority, due_date, task_type, assigned_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [employeeId, title, description || null, 'open', priority || 'medium', dueDate, taskType, null, ts, ts]
    );
    auditLog(req, 'create', 'task', r.lastID);
    return res.json({ id: r.lastID });
  } catch {
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

app.post('/employees/:id/assign-task', requireHr, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const priority = String(req.body?.priority || 'medium').trim();
    const dueDate = req.body?.due_date ? String(req.body.due_date) : null;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const ts = nowIso();
    const r = await dbRun(
      'INSERT INTO tasks (employee_id, title, description, status, priority, due_date, task_type, assigned_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [employeeId, title, description || null, 'open', priority || 'medium', dueDate, 'assigned', String(req.user.name || 'HR'), ts, ts]
    );
    auditLog(req, 'assign', 'task', r.lastID);
    return res.json({ id: r.lastID });
  } catch {
    return res.status(500).json({ error: 'Failed to assign task' });
  }
});

app.put('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const task = await dbGet('SELECT id, employee_id, status FROM tasks WHERE id = ?', [id]);
    if (!task) return res.status(404).json({ error: 'Not found' });
    if (!isSelfOrHr(req.user, task.employee_id)) return res.status(403).json({ error: 'Forbidden' });

    const fields = {
      title: req.body?.title,
      description: req.body?.description,
      status: req.body?.status,
      priority: req.body?.priority,
      due_date: req.body?.due_date,
    };

    const updates = [];
    const params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      updates.push(`${k} = ?`);
      params.push(v === null ? null : String(v));
    }
    updates.push('updated_at = ?');
    params.push(nowIso());

    if (fields.status !== undefined) {
      const newStatus = String(fields.status || '');
      if (newStatus === 'done' || newStatus === 'completed') {
        updates.push('completed_at = ?');
        params.push(nowIso());
      }
    }

    if (updates.length === 1) return res.json({ ok: true });
    params.push(id);
    await dbRun(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);
    auditLog(req, 'update', 'task', id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const task = await dbGet('SELECT id, employee_id FROM tasks WHERE id = ?', [id]);
    if (!task) return res.status(404).json({ error: 'Not found' });
    if (!isSelfOrHr(req.user, task.employee_id)) return res.status(403).json({ error: 'Forbidden' });
    await dbRun('DELETE FROM tasks WHERE id = ?', [id]);
    auditLog(req, 'delete', 'task', id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ===== Time tracking =====
function isoDateOnly(d) {
  const dt = d ? new Date(d) : new Date();
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMonday(dateStr) {
  const dt = dateStr ? new Date(dateStr) : new Date();
  const day = dt.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return isoDateOnly(dt);
}

function msToHours(ms) {
  return Math.max(0, ms) / 3600000;
}

async function sumTimeForEmployee(employeeId, startDate, endDateExclusive) {
  const rows = await dbAll(
    'SELECT start_ts, end_ts FROM time_entries WHERE employee_id = ? AND work_date >= ? AND work_date < ?',
    [employeeId, startDate, endDateExclusive]
  );
  let totalMs = 0;
  for (const r of rows) {
    const s = new Date(r.start_ts).getTime();
    const e = r.end_ts ? new Date(r.end_ts).getTime() : Date.now();
    if (Number.isFinite(s) && Number.isFinite(e)) totalMs += Math.max(0, e - s);
  }
  return msToHours(totalMs);
}

app.post('/employees/:id/time/start', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const today = isoDateOnly();
    const open = await dbGet(
      'SELECT id FROM time_entries WHERE employee_id = ? AND work_date = ? AND end_ts IS NULL ORDER BY id DESC LIMIT 1',
      [employeeId, today]
    );
    if (open) return res.json({ ok: true, already_running: true });
    const ts = nowIso();
    const r = await dbRun(
      'INSERT INTO time_entries (employee_id, start_ts, end_ts, work_date, created_at) VALUES (?, ?, NULL, ?, ?)',
      [employeeId, ts, today, ts]
    );
    auditLog(req, 'start', 'time', r.lastID);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to start timer' });
  }
});

app.post('/employees/:id/time/stop', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const today = isoDateOnly();
    const open = await dbGet(
      'SELECT id FROM time_entries WHERE employee_id = ? AND work_date = ? AND end_ts IS NULL ORDER BY id DESC LIMIT 1',
      [employeeId, today]
    );
    if (!open) return res.json({ ok: true, not_running: true });
    await dbRun('UPDATE time_entries SET end_ts = ? WHERE id = ?', [nowIso(), open.id]);
    auditLog(req, 'stop', 'time', open.id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to stop timer' });
  }
});

app.get('/employees/:id/time/summary', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const today = isoDateOnly();
    const wk = startOfWeekMonday(today);
    const dtToday = new Date(today);
    const dtWk = new Date(wk);
    const dtWkEnd = new Date(dtWk);
    dtWkEnd.setDate(dtWkEnd.getDate() + 7);
    const weekEnd = isoDateOnly(dtWkEnd);
    const dtTomorrow = new Date(dtToday);
    dtTomorrow.setDate(dtTomorrow.getDate() + 1);
    const tomorrow = isoDateOnly(dtTomorrow);

    const [todayH, weekH, totalH] = await Promise.all([
      sumTimeForEmployee(employeeId, today, tomorrow),
      sumTimeForEmployee(employeeId, wk, weekEnd),
      sumTimeForEmployee(employeeId, '0000-01-01', '9999-12-31')
    ]);

    const running = await dbGet(
      'SELECT id FROM time_entries WHERE employee_id = ? AND work_date = ? AND end_ts IS NULL ORDER BY id DESC LIMIT 1',
      [employeeId, today]
    );

    return res.json({
      employee_id: employeeId,
      running: !!running,
      today_hours: Number(todayH.toFixed(2)),
      week_hours: Number(weekH.toFixed(2)),
      total_hours: Number(totalH.toFixed(2))
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load summary' });
  }
});

// ===== Timesheets =====
app.get('/employees/:id/timesheet/week', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const weekStart = String(req.query.week_start || '').trim();
    if (!weekStart) return res.status(400).json({ error: 'week_start required' });

    const sheet = await dbGet(
      'SELECT id, status, hr_note FROM timesheets WHERE employee_id = ? AND week_start = ?',
      [employeeId, weekStart]
    );

    const days = [];
    const base = new Date(weekStart);
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const day = isoDateOnly(d);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const nextDay = isoDateOnly(next);
      const hours = await sumTimeForEmployee(employeeId, day, nextDay);
      const open = await dbGet(
        'SELECT id FROM time_entries WHERE employee_id = ? AND work_date = ? AND end_ts IS NULL LIMIT 1',
        [employeeId, day]
      );
      const noteRow = await dbGet(
        'SELECT note FROM timesheet_notes WHERE employee_id = ? AND work_date = ?',
        [employeeId, day]
      );
      days.push({ date: day, hours: Number(hours.toFixed(2)), open: !!open, note: noteRow ? (noteRow.note || '') : '' });
    }

    const total = days.reduce((a, b) => a + Number(b.hours || 0), 0);
    const openCount = days.filter(d => d.open).length;
    return res.json({
      employee_id: employeeId,
      week_start: weekStart,
      status: sheet ? sheet.status : 'draft',
      hr_note: sheet ? (sheet.hr_note || '') : '',
      total_hours: Number(total.toFixed(2)),
      open_entries: openCount,
      days
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load timesheet' });
  }
});

app.post('/employees/:id/timesheet/note', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const workDate = String(req.body?.work_date || '').trim();
    const note = String(req.body?.note || '');
    if (!workDate) return res.status(400).json({ error: 'work_date required' });
    await dbRun(
      'INSERT INTO timesheet_notes (employee_id, work_date, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, work_date) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at',
      [employeeId, workDate, note, nowIso()]
    );
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to save note' });
  }
});

app.post('/employees/:id/timesheet/submit', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const weekStart = String(req.body?.week_start || '').trim();
    if (!weekStart) return res.status(400).json({ error: 'week_start required' });
    const exists = await dbGet('SELECT id FROM timesheets WHERE employee_id = ? AND week_start = ?', [employeeId, weekStart]);
    if (!exists) {
      await dbRun(
        'INSERT INTO timesheets (employee_id, week_start, status, submitted_at) VALUES (?, ?, ?, ?)',
        [employeeId, weekStart, 'submitted', nowIso()]
      );
    } else {
      await dbRun(
        'UPDATE timesheets SET status = ?, submitted_at = ? WHERE id = ?',
        ['submitted', nowIso(), exists.id]
      );
    }
    auditLog(req, 'submit', 'timesheet', exists ? exists.id : null);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to submit timesheet' });
  }
});

app.get('/timesheets', requireHr, async (req, res) => {
  try {
    const weekStart = String(req.query.week_start || '').trim();
    const status = String(req.query.status || '').trim();
    const where = [];
    const params = [];
    if (weekStart) {
      where.push('t.week_start = ?');
      params.push(weekStart);
    }
    if (status) {
      where.push('t.status = ?');
      params.push(status);
    }
    const sql = `
      SELECT t.id, t.employee_id, e.name as employee_name, t.week_start, t.status, t.hr_note, t.submitted_at, t.decided_at
      FROM timesheets t
      JOIN employees e ON e.id = t.employee_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.id DESC
      LIMIT 200
    `;
    const rows = await dbAll(sql, params);
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load timesheets' });
  }
});

app.post('/timesheets/:id/decision', requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    const hrNote = req.body?.hr_note !== undefined ? String(req.body.hr_note) : null;
    const status = decision === 'approve' ? 'approved' : (decision === 'reject' ? 'rejected' : '');
    if (!status) return res.status(400).json({ error: 'Invalid decision' });
    const r = await dbRun(
      'UPDATE timesheets SET status = ?, hr_note = ?, decided_at = ? WHERE id = ?',
      [status, hrNote, nowIso(), id]
    );
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    auditLog(req, 'decide', 'timesheet', id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to review timesheet' });
  }
});

app.get('/timesheets/export.csv', requireHr, async (req, res) => {
  try {
    const weekStart = String(req.query.week_start || '').trim();
    const status = String(req.query.status || '').trim();
    const qs = [];
    const params = [];
    if (weekStart) {
      qs.push('t.week_start = ?');
      params.push(weekStart);
    }
    if (status) {
      qs.push('t.status = ?');
      params.push(status);
    }
    const rows = await dbAll(
      `SELECT t.id, e.name as employee_name, t.employee_id, t.week_start, t.status, COALESCE(t.hr_note, '') as hr_note, COALESCE(t.submitted_at, '') as submitted_at, COALESCE(t.decided_at, '') as decided_at
       FROM timesheets t JOIN employees e ON e.id = t.employee_id
       ${qs.length ? `WHERE ${qs.join(' AND ')}` : ''}
       ORDER BY t.id DESC LIMIT 500`,
      params
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="timesheets.csv"');
    const header = 'id,employee_id,employee_name,week_start,status,hr_note,submitted_at,decided_at\n';
    const lines = rows.map(r => {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [r.id, r.employee_id, r.employee_name, r.week_start, r.status, r.hr_note, r.submitted_at, r.decided_at].map(esc).join(',');
    });
    return res.send(header + lines.join('\n'));
  } catch {
    return res.status(500).send('Failed to export CSV');
  }
});

// ===== Requests =====
app.get('/employees/:id/requests', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const rows = await dbAll(
      'SELECT id, employee_id, type, start_date, end_date, status, hr_note, created_at FROM requests WHERE employee_id = ? ORDER BY id DESC LIMIT 200',
      [employeeId]
    );
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load requests' });
  }
});

app.post('/employees/:id/requests', requireAuth, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!isSelfOrHr(req.user, employeeId)) return res.status(403).json({ error: 'Forbidden' });
    const type = String(req.body?.type || '').trim().toLowerCase();
    const startDate = String(req.body?.start_date || '').trim();
    const endDate = req.body?.end_date ? String(req.body.end_date).trim() : null;
    if (!type || !startDate) return res.status(400).json({ error: 'Missing fields' });
    const r = await dbRun(
      'INSERT INTO requests (employee_id, type, start_date, end_date, status, hr_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [employeeId, type, startDate, endDate, 'pending', null, nowIso()]
    );
    auditLog(req, 'create', 'request', r.lastID);
    return res.json({ id: r.lastID });
  } catch {
    return res.status(500).json({ error: 'Failed to submit request' });
  }
});

app.get('/requests', requireHr, async (req, res) => {
  try {
    const type = String(req.query.type || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const where = [];
    const params = [];
    if (type && type !== 'all') {
      where.push('r.type = ?');
      params.push(type);
    }
    if (status && status !== 'all') {
      where.push('r.status = ?');
      params.push(status);
    }
    const sql = `
      SELECT r.id, r.employee_id, e.name as employee_name, r.type, r.start_date, r.end_date, r.status, r.hr_note, r.created_at
      FROM requests r
      JOIN employees e ON e.id = r.employee_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.id DESC
      LIMIT 200
    `;
    const rows = await dbAll(sql, params);
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load requests' });
  }
});

app.post('/requests/:id/review', requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').trim().toLowerCase();
    const hrNote = req.body?.hr_note !== undefined ? String(req.body.hr_note) : null;
    if (status !== 'approved' && status !== 'rejected') return res.status(400).json({ error: 'Invalid status' });
    const r = await dbRun(
      'UPDATE requests SET status = ?, hr_note = ?, reviewed_at = ?, reviewed_by_name = ? WHERE id = ?',
      [status, hrNote, nowIso(), String(req.user.name || 'HR'), id]
    );
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    auditLog(req, 'review', 'request', id);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to review request' });
  }
});

// ===== Calendar (Leave) =====
app.get('/calendar/leave', requireAuth, async (req, res) => {
  try {
    const start = String(req.query.start || '').trim();
    const end = String(req.query.end || '').trim();
    const rows = await dbAll(
      `SELECT r.id, r.employee_id, e.name as employee_name, r.start_date, r.end_date, r.status
       FROM requests r JOIN employees e ON e.id = r.employee_id
       WHERE r.type = 'leave'
       ${start ? 'AND r.start_date >= ?' : ''}
       ${end ? 'AND (r.end_date <= ? OR r.end_date IS NULL)' : ''}
       ORDER BY r.start_date ASC
       LIMIT 500`,
      [
        ...(start ? [start] : []),
        ...(end ? [end] : []),
      ]
    );
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load leave calendar' });
  }
});

// ===== Announcements =====
app.get('/announcements', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const rows = await dbAll(
      'SELECT id, title, body, created_at, created_by_name FROM announcements ORDER BY id DESC LIMIT ?',
      [limit]
    );
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load announcements' });
  }
});

app.post('/announcements', requireHr, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!title || !body) return res.status(400).json({ error: 'Missing fields' });
    const r = await dbRun(
      'INSERT INTO announcements (title, body, created_at, created_by_name) VALUES (?, ?, ?, ?)',
      [title, body, nowIso(), String(req.user.name || 'HR')]
    );
    auditLog(req, 'create', 'announcement', r.lastID);
    return res.json({ id: r.lastID });
  } catch {
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// ===== Analytics / Attention =====
app.get('/analytics/workload', requireHr, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT e.id as employee_id, e.name,
        SUM(CASE WHEN t.status IN ('open','in_progress') THEN 1 ELSE 0 END) as open_tasks,
        SUM(CASE WHEN t.status = 'overdue' THEN 1 ELSE 0 END) as overdue_tasks,
        SUM(CASE WHEN t.status IN ('done','completed') THEN 1 ELSE 0 END) as completed_tasks
       FROM employees e
       LEFT JOIN tasks t ON t.employee_id = e.id
       GROUP BY e.id
       ORDER BY open_tasks DESC, overdue_tasks DESC
       LIMIT 200`
    );
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load workload analytics' });
  }
});

app.get('/analytics/leaderboard', requireHr, async (req, res) => {
  try {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const weekAgoIso = weekAgo.toISOString();
    const top = await dbAll(
      `SELECT e.id as employee_id, e.name, COUNT(t.id) as tasks_done_7d
       FROM employees e
       LEFT JOIN tasks t ON t.employee_id = e.id AND t.completed_at IS NOT NULL AND t.completed_at >= ?
       GROUP BY e.id
       ORDER BY tasks_done_7d DESC
       LIMIT 10`,
      [weekAgoIso]
    );
    return res.json({ top_tasks_done_week: top });
  } catch {
    return res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

app.get('/attention', requireHr, async (req, res) => {
  try {
    const pendingRequests = await dbGet("SELECT COUNT(*) as c FROM requests WHERE status = 'pending'");
    const overdueTasks = await dbAll(
      `SELECT e.name, t.title, t.priority, COALESCE(t.due_date,'') as due_date
       FROM tasks t JOIN employees e ON e.id = t.employee_id
       WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date < date('now')
       ORDER BY t.due_date ASC LIMIT 10`
    );
    const dueSoon = await dbAll(
      `SELECT e.name, t.title, t.priority, COALESCE(t.due_date,'') as due_date
       FROM tasks t JOIN employees e ON e.id = t.employee_id
       WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date >= date('now') AND t.due_date <= date('now','+3 days')
       ORDER BY t.due_date ASC LIMIT 10`
    );
    return res.json({
      summary: {
        pending_requests: Number(pendingRequests?.c || 0),
        overdue_tasks: overdueTasks.length,
        due_soon_tasks: dueSoon.length,
        no_recent_time_entries: 0,
        late_checkins_today: 0,
        missing_checkout: 0,
        long_shifts_last_7_days: 0,
      },
      overdue_tasks: overdueTasks,
      due_soon_tasks: dueSoon,
      pending_requests: []
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load attention' });
  }
});

// ===== Audit =====
app.get('/audit', requireHr, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const rows = await dbAll(
      'SELECT id, actor_role, actor_name, action, entity, entity_id, created_at FROM audit ORDER BY id DESC LIMIT ?',
      [limit]
    );
    return res.json({ rows });
  } catch {
    return res.status(500).json({ error: 'Failed to load audit log' });
  }
});

// TODO: Add modules for: HR Database, Recruitment, Onboarding, Performance Management, Benefits Administration, Time and Attendance, Leave Management, Payroll, Workforce Management, Succession Planning, HR Analytics

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
  });
