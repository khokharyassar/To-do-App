/* ============================================================
   TASKFLOW – APP.JS
   Login PIN + All task logic + Reminders + Mobile-ready
   Pure static: works on GitHub Pages via localStorage
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTS & STORAGE KEYS
// ============================================================
const STORAGE_KEY      = 'taskflow_v2';
const COMPLETIONS_KEY  = 'taskflow_daily_v2';
const PIN_KEY          = 'taskflow_pin_hash';
const SESSION_KEY      = 'taskflow_session';
const DEFAULT_PIN      = '1234'; // user changes on first setup

// ============================================================
// DATA
// ============================================================
let tasks          = [];
let dailyCompletions = {};
let editingTaskId  = null;

function saveTasks()       { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }
function saveCompletions() { localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(dailyCompletions)); }

function loadData() {
  try { tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { tasks = []; }
  try { dailyCompletions = JSON.parse(localStorage.getItem(COMPLETIONS_KEY)) || {}; } catch { dailyCompletions = {}; }
}

// ============================================================
// PIN / AUTH
// ============================================================
function hashPin(pin) {
  // btoa-based encoding — 100% consistent across all browsers & page loads
  // (client-side privacy, not cryptographic security)
  return btoa('taskflow::' + pin + '::v2');
}

function getStoredHash()          { return localStorage.getItem(PIN_KEY); }
function setStoredHash(pin)       { localStorage.setItem(PIN_KEY, hashPin(pin)); }
function isPinSet()               { return !!getStoredHash(); }
function isPinCorrect(pin)        { return hashPin(pin) === getStoredHash(); }

function setSession()             { sessionStorage.setItem(SESSION_KEY, '1'); }
function isSessionActive()        { return sessionStorage.getItem(SESSION_KEY) === '1'; }
function clearSession()           { sessionStorage.removeItem(SESSION_KEY); }

// ============================================================
// UTILITIES
// ============================================================
function generateId() {
  return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }
function getTodayDow() { return new Date().getDay(); }

function formatDateTime(dateStr, timeStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + (timeStr ? 'T'+timeStr : 'T00:00'));
  let r = d.toLocaleDateString('en-IN', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
  if (timeStr) r += ' at ' + formatTime(timeStr);
  return r;
}

function formatTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${pad(m)} ${h>=12?'PM':'AM'}`;
}

function formatRelative(dateStr, timeStr) {
  const now    = new Date();
  const target = new Date(dateStr + 'T' + (timeStr||'00:00'));
  const diff   = target - now;
  const mins   = Math.round(diff/60000);
  const hours  = Math.round(diff/3600000);
  const days   = Math.round(diff/86400000);
  if (diff < 0) {
    if (Math.abs(mins)<60)  return `${Math.abs(mins)}m ago`;
    if (Math.abs(hours)<24) return `${Math.abs(hours)}h ago`;
    return `${Math.abs(days)}d ago`;
  }
  if (mins < 60)  return `in ${mins}m`;
  if (hours < 24) return `in ${hours}h`;
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

function isOverdue(task) {
  if (task.type === 'reminder' && !task.completed) {
    return new Date(task.reminderDate+'T'+(task.reminderTime||'00:00')) < new Date();
  }
  if (task.type === 'todo' && !task.completed && task.dueDate) {
    return new Date(task.dueDate+'T23:59') < new Date();
  }
  return false;
}

function isDailyDoneToday(id) {
  return !!dailyCompletions[`${id}_${getTodayStr()}`];
}

const DAY_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ============================================================
// UI STATE
// ============================================================
let currentSection     = 'overview';
let selectedType       = 'todo';
let selectedPriority   = 'low';
let selectedDays       = [0,1,2,3,4,5,6];
let todoFilterPriority = 'all';
let todoSort           = 'created';
let dailyDayFilter     = -1;
let reminderFilter     = 'upcoming';
let todoSearch         = '';

// ============================================================
// DOM HELPER
// ============================================================
const $ = id => document.getElementById(id);

// ============================================================
// ============================================================
//  PIN / LOGIN LOGIC
// ============================================================
// ============================================================
let loginPin  = '';
let setupPin  = '';
let setupStep = 1;
let firstPin  = '';
let currentView = 'login'; // 'login' | 'register'

function initLoginScreen() {
  if (isSessionActive()) { showApp(); return; }
  if (!isPinSet()) showRegisterView();
  else             showLoginView();
}

function showLoginView() {
  currentView = 'login';
  loginPin = '';
  $('view-login').style.display  = 'block';
  $('view-register').style.display = 'none';
  updatePinDots('pin-dot', loginPin);
  $('pin-error').textContent = '';
}

function showRegisterView() {
  currentView = 'register';
  setupPin  = '';
  setupStep = 1;
  firstPin  = '';
  $('view-register').style.display = 'block';
  $('view-login').style.display    = 'none';
  updatePinDots('setup-dot', setupPin);
  $('setup-error').textContent = '';
  $('setup-hint').textContent  = 'Step 1 of 2 — Choose your PIN';
  $('setup-step-bar').style.width = '50%';
}

// alias
const showSetupView = showRegisterView;

function updatePinDots(prefix, pin) {
  for (let i = 0; i < 4; i++) {
    const dot = $(prefix+'-'+i);
    if (!dot) continue;
    dot.classList.remove('filled','error');
    if (i < pin.length) dot.classList.add('filled');
  }
}

function markDotsError(prefix) {
  for (let i = 0; i < 4; i++) {
    const dot = $(prefix+'-'+i);
    if (dot) { dot.classList.remove('filled'); dot.classList.add('error'); }
  }
  setTimeout(() => {
    for (let i = 0; i < 4; i++) {
      const dot = $(prefix+'-'+i);
      if (dot) dot.classList.remove('error');
    }
  }, 600);
}

// Login: add digit
function loginAddDigit(d) {
  if (loginPin.length >= 4) return;
  loginPin += d;
  updatePinDots('pin-dot', loginPin);
  $('pin-error').textContent = '';
  if (loginPin.length === 4) setTimeout(attemptLogin, 150);
}
function loginBackspace() {
  loginPin = loginPin.slice(0,-1);
  updatePinDots('pin-dot', loginPin);
}
function attemptLogin() {
  if (isPinCorrect(loginPin)) {
    setSession();
    showApp();
  } else {
    markDotsError('pin-dot');
    $('pin-error').textContent = 'Wrong PIN. Try again.';
    loginPin = '';
    setTimeout(() => updatePinDots('pin-dot', loginPin), 600);
  }
}

// Setup PIN
function setupAddDigit(d) {
  if (setupPin.length >= 4) return;
  setupPin += d;
  updatePinDots('setup-dot', setupPin);
  $('setup-error').textContent = '';
  if (setupPin.length === 4) setTimeout(advanceSetup, 150);
}
function setupBackspace() {
  setupPin = setupPin.slice(0,-1);
  updatePinDots('setup-dot', setupPin);
}

function advanceSetup() {
  if (setupStep === 1) {
    firstPin  = setupPin;
    setupPin  = '';
    setupStep = 2;
    updatePinDots('setup-dot', setupPin);
    $('setup-hint').textContent = 'Step 2 of 2 — Confirm your PIN';
    $('setup-step-bar').style.width = '100%';
  } else {
    if (setupPin === firstPin) {
      setStoredHash(firstPin);
      setSession();
      showToast('PIN created! You are now logged in 🔐', 'success');
      showApp();
    } else {
      markDotsError('setup-dot');
      $('setup-error').textContent = "PINs don't match. Start over.";
      setupPin  = '';
      setupStep = 1;
      firstPin  = '';
      updatePinDots('setup-dot', setupPin);
      $('setup-hint').textContent = 'Step 1 of 2 — Choose your PIN';
      $('setup-step-bar').style.width = '50%';
    }
  }
}

function showApp() {
  $('login-screen').style.display = 'none';
  $('app-root').style.display     = 'flex';
  loadData();
  maybeLoadSampleData();
  injectSvgGradient();
  renderAll();
  requestNotifPermission();
}

function lockApp() {
  clearSession();
  $('app-root').style.display     = 'none';
  $('login-screen').style.display = 'flex';
  loginPin = '';
  showLoginView();
}

// ============================================================
// CHANGE PIN (in-app modal)
// ============================================================
function openChangePinModal() {
  $('old-pin-input').value = '';
  $('new-pin-input').value = '';
  $('confirm-pin-input').value = '';
  $('pin-change-error').textContent = '';
  $('pin-change-modal').classList.remove('modal-hidden');
  $('modal-overlay').classList.remove('modal-hidden');
  setTimeout(() => $('old-pin-input').focus(), 100);
}

function closeChangePinModal() {
  $('pin-change-modal').classList.add('modal-hidden');
  $('modal-overlay').classList.add('modal-hidden');
}

function saveNewPin() {
  const old     = $('old-pin-input').value.trim();
  const newPin  = $('new-pin-input').value.trim();
  const confirm = $('confirm-pin-input').value.trim();

  if (!isPinCorrect(old)) {
    $('pin-change-error').textContent = 'Current PIN is wrong';
    return;
  }
  if (!/^\d{4}$/.test(newPin)) {
    $('pin-change-error').textContent = 'New PIN must be exactly 4 digits';
    return;
  }
  if (newPin !== confirm) {
    $('pin-change-error').textContent = "New PINs don't match";
    return;
  }
  setStoredHash(newPin);
  closeChangePinModal();
  showToast('PIN updated! 🔐', 'success');
}

// ============================================================
// SECTION NAVIGATION
// ============================================================
function navigateTo(section) {
  currentSection = section;

  // Desktop sidebar
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  // Mobile bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  // Sections
  document.querySelectorAll('.content-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `section-${section}`);
  });

  // Scroll to top
  const scrollWrap = $('scroll-wrap');
  if (scrollWrap) scrollWrap.scrollTop = 0;

  const titles = {
    overview:  'Overview',
    todo:      'To-Do',
    daily:     'Daily Tasks',
    reminders: 'Reminders',
    completed: 'Completed',
  };
  $('page-title').textContent = titles[section] || section;

  renderAll();
}

// ============================================================
// TASK MODAL
// ============================================================
function openModal(editId = null) {
  editingTaskId = editId;
  $('task-title-input').value   = '';
  $('task-desc-input').value    = '';
  $('reminder-date-input').value = '';
  $('reminder-time-input').value = '';
  $('todo-due-input').value     = '';
  $('daily-time-input').value   = '';
  $('reminder-notify-input').value = '0';

  if (editId) {
    const task = tasks.find(t => t.id === editId);
    if (!task) return;
    $('modal-title').textContent = 'Edit Task';
    setType(task.type);
    setPriority(task.priority || 'low');
    $('task-title-input').value  = task.title;
    $('task-desc-input').value   = task.description || '';
    if (task.type === 'daily') {
      selectedDays = task.repeatDays ? [...task.repeatDays] : [0,1,2,3,4,5,6];
      $('daily-time-input').value = task.dailyTime || '';
      renderDayBtns();
    }
    if (task.type === 'reminder') {
      $('reminder-date-input').value = task.reminderDate || '';
      $('reminder-time-input').value = task.reminderTime || '';
      $('reminder-notify-input').value = task.notifyBefore || '0';
    }
    if (task.type === 'todo') {
      $('todo-due-input').value = task.dueDate || '';
    }
  } else {
    $('modal-title').textContent = 'Add Task';
    const typeMap = { todo:'todo', daily:'daily', reminders:'reminder' };
    setType(typeMap[currentSection] || 'todo');
    setPriority('low');
    selectedDays = [0,1,2,3,4,5,6];
    renderDayBtns();
  }

  $('task-modal').classList.remove('modal-hidden');
  $('modal-overlay').classList.remove('modal-hidden');
  setTimeout(() => $('task-title-input').focus(), 200);
}

function closeModal() {
  $('task-modal').classList.add('modal-hidden');
  $('modal-overlay').classList.add('modal-hidden');
  editingTaskId = null;
}

function setType(type) {
  selectedType = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  $('daily-options').classList.toggle('task-opts-hidden',    type !== 'daily');
  $('reminder-options').classList.toggle('task-opts-hidden', type !== 'reminder');
  $('todo-options').classList.toggle('task-opts-hidden',     type !== 'todo');
}

function setPriority(p) {
  selectedPriority = p;
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === p);
  });
}

function renderDayBtns() {
  document.querySelectorAll('#day-selector .day-btn').forEach(btn => {
    btn.classList.toggle('active', selectedDays.includes(parseInt(btn.dataset.day)));
  });
}

function saveTask() {
  const title = $('task-title-input').value.trim();
  if (!title) { showToast('Please enter a title', 'error'); return; }

  if (selectedType === 'reminder') {
    if (!$('reminder-date-input').value) { showToast('Choose a date', 'error'); return; }
    if (!$('reminder-time-input').value) { showToast('Choose a time', 'error'); return; }
  }
  if (selectedType === 'daily' && selectedDays.length === 0) {
    showToast('Select at least one day', 'error'); return;
  }

  const base = {
    title,
    description: $('task-desc-input').value.trim(),
    type:        selectedType,
    priority:    selectedPriority,
    completed:   false,
    createdAt:   Date.now(),
  };

  if (selectedType === 'daily') {
    base.repeatDays = [...selectedDays];
    base.dailyTime  = $('daily-time-input').value;
  }
  if (selectedType === 'reminder') {
    base.reminderDate  = $('reminder-date-input').value;
    base.reminderTime  = $('reminder-time-input').value;
    base.notifyBefore  = parseInt($('reminder-notify-input').value) || 0;
    base.notified      = false;
  }
  if (selectedType === 'todo') {
    base.dueDate = $('todo-due-input').value;
  }

  if (editingTaskId) {
    const idx = tasks.findIndex(t => t.id === editingTaskId);
    if (idx !== -1) tasks[idx] = { ...tasks[idx], ...base, id: editingTaskId };
    showToast('Task updated ✅', 'success');
  } else {
    base.id = generateId();
    tasks.unshift(base);
    showToast('Task added ✅', 'success');
  }

  saveTasks();
  closeModal();
  renderAll();
}

// ============================================================
// TASK OPERATIONS
// ============================================================
function toggleComplete(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  if (task.type === 'daily') {
    const key = `${taskId}_${getTodayStr()}`;
    dailyCompletions[key] = !dailyCompletions[key];
    saveCompletions();
  } else {
    task.completed   = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    saveTasks();
  }
  renderAll();
}

function deleteTask(taskId) {
  tasks = tasks.filter(t => t.id !== taskId);
  saveTasks();
  showToast('Task deleted', 'warning');
  renderAll();
}

function clearCompleted() {
  const n = tasks.filter(t => t.completed && t.type !== 'daily').length;
  tasks = tasks.filter(t => !(t.completed && t.type !== 'daily'));
  saveTasks();
  showToast(`Cleared ${n} task${n!==1?'s':''}`, 'success');
  renderAll();
}

// ============================================================
// RENDER – task card
// ============================================================
function buildCard(task, opts = {}) {
  const { isDailyMode = false, dailyDone = false, mini = false } = opts;
  const done    = isDailyMode ? dailyDone : task.completed;
  const overdue = isOverdue(task);

  const card = document.createElement('div');
  card.className = [
    'task-card',
    done    ? 'completed' : '',
    overdue ? 'overdue'   : '',
    `priority-${task.priority||'low'}`,
  ].filter(Boolean).join(' ');

  // Checkbox
  const chk = document.createElement('div');
  chk.className = 'task-checkbox' + (done ? ' checked' : '');
  chk.setAttribute('role','checkbox');
  chk.setAttribute('aria-checked', done ? 'true' : 'false');
  chk.setAttribute('tabindex','0');
  chk.addEventListener('click', () => toggleComplete(task.id));
  chk.addEventListener('keydown', e => { if (e.key===' '||e.key==='Enter') toggleComplete(task.id); });

  // Body
  const body = document.createElement('div');
  body.className = 'task-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'task-title';
  titleEl.textContent = task.title;
  body.appendChild(titleEl);

  if (task.description && !mini) {
    const desc = document.createElement('div');
    desc.className = 'task-desc';
    desc.textContent = task.description;
    body.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  if (task.type === 'daily') {
    meta.appendChild(tag('🔄 Daily','tag-daily'));
    if (task.dailyTime) meta.appendChild(tag('⏰ '+formatTime(task.dailyTime),'tag-daily'));
    if (!mini) {
      const days = (task.repeatDays||[0,1,2,3,4,5,6]).map(d=>DAY_SHORT[d]).join(', ');
      meta.appendChild(tag(days,'tag-daily'));
    }
  }
  if (task.type === 'todo') {
    if (task.dueDate) {
      meta.appendChild(tag((overdue?'⚠️ Overdue: ':'📅 ')+formatDateTime(task.dueDate), overdue?'tag-overdue':'tag-todo'));
    } else {
      meta.appendChild(tag('✅ To-Do','tag-todo'));
    }
  }
  if (task.type === 'reminder') {
    meta.appendChild(tag((overdue?'⚠️ ':'🔔 ')+formatDateTime(task.reminderDate, task.reminderTime), overdue?'tag-overdue':'tag-reminder'));
    if (!overdue && !mini) meta.appendChild(tag(formatRelative(task.reminderDate, task.reminderTime),'tag-reminder'));
  }
  if (!mini) {
    if (task.priority === 'high')   meta.appendChild(tag('🔴 High','tag-high'));
    if (task.priority === 'medium') meta.appendChild(tag('🟡 Medium','tag-medium'));
  }

  body.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn edit';
  editBtn.title = 'Edit';
  editBtn.innerHTML = '✏️';
  editBtn.setAttribute('aria-label','Edit task');
  editBtn.addEventListener('click', e => { e.stopPropagation(); openModal(task.id); });

  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn delete';
  delBtn.title = 'Delete';
  delBtn.innerHTML = '🗑️';
  delBtn.setAttribute('aria-label','Delete task');
  delBtn.addEventListener('click', e => { e.stopPropagation(); if(confirm(`Delete "${task.title}"?`)) deleteTask(task.id); });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(chk);
  card.appendChild(body);
  card.appendChild(actions);
  return card;
}

function tag(text, cls) {
  const el = document.createElement('span');
  el.className = 'task-tag ' + cls;
  el.textContent = text;
  return el;
}

function renderList(container, items, emptyEl, fn) {
  container.innerHTML = '';
  if (items.length === 0) {
    if (emptyEl) emptyEl.classList.remove('sect-hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('sect-hidden');
  items.forEach(item => container.appendChild(fn(item)));
}

// ============================================================
// RENDER OVERVIEW
// ============================================================
function renderOverview() {
  const dow = getTodayDow();
  const todayDailies = tasks.filter(t => t.type==='daily' && (t.repeatDays||[0,1,2,3,4,5,6]).includes(dow));
  $('daily-today-tag').textContent = todayDailies.length;
  renderList($('overview-daily-list'), todayDailies, null, t =>
    buildCard(t, { isDailyMode:true, dailyDone:isDailyDoneToday(t.id), mini:true })
  );
  if (todayDailies.length===0) $('overview-daily-list').innerHTML = '<p style="color:var(--text-muted);font-size:.82rem;padding:.3rem 0">No daily tasks for today</p>';

  const now = new Date();
  const upcoming = tasks
    .filter(t => t.type==='reminder' && !t.completed && new Date(t.reminderDate+'T'+(t.reminderTime||'00:00')) >= now)
    .sort((a,b) => new Date(a.reminderDate+'T'+(a.reminderTime||'00:00')) - new Date(b.reminderDate+'T'+(b.reminderTime||'00:00')))
    .slice(0,5);
  $('reminders-upcoming-tag').textContent = upcoming.length;
  renderList($('overview-reminders-list'), upcoming, null, t => buildCard(t, {mini:true}));
  if (upcoming.length===0) $('overview-reminders-list').innerHTML = '<p style="color:var(--text-muted);font-size:.82rem;padding:.3rem 0">No upcoming reminders</p>';

  const pMap = {high:3,medium:2,low:1};
  const pending = tasks
    .filter(t => t.type==='todo' && !t.completed)
    .sort((a,b) => {
      if (isOverdue(b) !== isOverdue(a)) return isOverdue(b)?1:-1;
      return (pMap[b.priority]||1) - (pMap[a.priority]||1);
    })
    .slice(0,5);
  $('todos-pending-tag').textContent = pending.length;
  renderList($('overview-todo-list'), pending, null, t => buildCard(t, {mini:true}));
  if (pending.length===0) $('overview-todo-list').innerHTML = '<p style="color:var(--text-muted);font-size:.82rem;padding:.3rem 0">All to-dos done! 🎉</p>';

  $('stat-todo-count').textContent     = tasks.filter(t=>t.type==='todo'&&!t.completed).length;
  $('stat-daily-count').textContent    = tasks.filter(t=>t.type==='daily').length;
  $('stat-reminder-count').textContent = tasks.filter(t=>t.type==='reminder'&&!t.completed).length;
  $('stat-overdue-count').textContent  = tasks.filter(isOverdue).length;
}

// ============================================================
// RENDER TO-DO
// ============================================================
function renderTodo() {
  const pMap = {high:3,medium:2,low:1};
  let items = tasks.filter(t => t.type==='todo');

  if (todoSearch) {
    const q = todoSearch.toLowerCase();
    items = items.filter(t => t.title.toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q));
  }
  if (todoFilterPriority !== 'all') items = items.filter(t => t.priority===todoFilterPriority);

  if (todoSort==='priority') {
    items.sort((a,b) => (pMap[b.priority]||1)-(pMap[a.priority]||1));
  } else if (todoSort==='due') {
    items.sort((a,b) => {
      if (!a.dueDate&&!b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate)-new Date(b.dueDate);
    });
  } else {
    items.sort((a,b) => b.createdAt-a.createdAt);
  }

  const overdue = items.filter(t=>!t.completed&&isOverdue(t));
  const normal  = items.filter(t=>!t.completed&&!isOverdue(t));
  const done    = items.filter(t=>t.completed);
  const sorted  = [...overdue, ...normal, ...done];

  renderList($('todo-list'), sorted, $('todo-empty'), t => buildCard(t));
}

// ============================================================
// RENDER DAILY
// ============================================================
function renderDaily() {
  let items = tasks.filter(t => t.type==='daily');
  if (dailyDayFilter !== -1) {
    items = items.filter(t => (t.repeatDays||[0,1,2,3,4,5,6]).includes(dailyDayFilter));
  }
  renderList($('daily-list'), items, $('daily-empty'), t =>
    buildCard(t, { isDailyMode:true, dailyDone:isDailyDoneToday(t.id) })
  );
}

// ============================================================
// RENDER REMINDERS
// ============================================================
function renderReminders() {
  const now = new Date();
  let items = tasks.filter(t => t.type==='reminder');

  if (reminderFilter==='upcoming') {
    items = items.filter(t => !t.completed && new Date(t.reminderDate+'T'+(t.reminderTime||'00:00')) >= now);
  } else if (reminderFilter==='past') {
    items = items.filter(t => new Date(t.reminderDate+'T'+(t.reminderTime||'00:00')) < now || t.completed);
  }

  items.sort((a,b) => {
    const da = new Date(a.reminderDate+'T'+(a.reminderTime||'00:00'));
    const db = new Date(b.reminderDate+'T'+(b.reminderTime||'00:00'));
    return da-db;
  });

  renderList($('reminders-list'), items, $('reminders-empty'), t => buildCard(t));
}

// ============================================================
// RENDER COMPLETED
// ============================================================
function renderCompleted() {
  const done = tasks.filter(t=>t.completed&&t.type!=='daily');
  done.sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));
  renderList($('completed-list'), done, $('completed-empty'), t => buildCard(t));
}

// ============================================================
// BADGES & PROGRESS
// ============================================================
function updateBadges() {
  const dow = getTodayDow();
  const todayDailies   = tasks.filter(t=>t.type==='daily'&&(t.repeatDays||[0,1,2,3,4,5,6]).includes(dow));
  const dailyDoneCount = todayDailies.filter(t=>isDailyDoneToday(t.id)).length;
  const dailyLeft      = todayDailies.length - dailyDoneCount;
  const todoLeft       = tasks.filter(t=>t.type==='todo'&&!t.completed).length;
  const now            = new Date();
  const remindersUp    = tasks.filter(t=>t.type==='reminder'&&!t.completed&&new Date(t.reminderDate+'T'+(t.reminderTime||'00:00'))>=now).length;
  const completedCount = tasks.filter(t=>t.completed&&t.type!=='daily').length;

  setBadge('badge-overview',   0);
  setBadge('badge-todo',       todoLeft);
  setBadge('badge-daily',      dailyLeft);
  setBadge('badge-reminders',  remindersUp);
  setBadge('badge-completed',  completedCount);

  // Mobile badges
  setMobileBadge('bnav-badge-todo',      todoLeft);
  setMobileBadge('bnav-badge-daily',     dailyLeft);
  setMobileBadge('bnav-badge-reminders', remindersUp);
  setMobileBadge('bnav-badge-completed', completedCount);

  // Progress
  const totalToday = todayDailies.length + tasks.filter(t=>t.type==='todo'&&!isOverdue(t)).length;
  const doneToday  = dailyDoneCount + tasks.filter(t=>t.type==='todo'&&t.completed).length;
  const pct = totalToday > 0 ? Math.round((doneToday/totalToday)*100) : 0;

  // Desktop ring
  const ring = $('progress-ring-fill');
  if (ring) ring.style.strokeDashoffset = 150.8 - (pct/100)*150.8;
  const pl = $('progress-label'); if (pl) pl.textContent = pct+'%';
  const pd = $('progress-done');  if (pd) pd.textContent = doneToday;
  const pt = $('progress-total'); if (pt) pt.textContent = totalToday;

  // Mobile progress
  const bar = $('mobile-progress-bar'); if (bar) bar.style.width = pct+'%';
  const mp  = $('mobile-pct');          if (mp)  mp.textContent  = pct+'%';
  const md  = $('mobile-done');         if (md)  md.textContent  = doneToday;
  const mt  = $('mobile-total');        if (mt)  mt.textContent  = totalToday;
}

function setBadge(id, count) {
  const el = $(id);
  if (!el) return;
  el.textContent = count > 0 ? count : '';
  el.classList.toggle('visible', count > 0);
}

function setMobileBadge(id, count) {
  const el = $(id);
  if (!el) return;
  el.textContent = count > 0 ? count : '';
  if (count > 0) el.classList.remove('bnav-hidden');
  else           el.classList.add('bnav-hidden');
}

function renderAll() {
  renderOverview();
  renderTodo();
  renderDaily();
  renderReminders();
  renderCompleted();
  updateBadges();
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
  const now = new Date();
  const t   = now.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
  const d   = now.toLocaleDateString('en-IN', {weekday:'short', month:'short', day:'numeric'});
  const el  = $('current-datetime');
  if (el) el.innerHTML = `<div style="font-weight:700;color:var(--text-primary)">${t}</div><div>${d}</div>`;
}

// ============================================================
// REMINDER CHECKER
// ============================================================
function checkReminders() {
  const now = new Date();
  tasks.forEach(t => {
    if (t.type!=='reminder'||t.completed||t.notified) return;
    const target  = new Date(t.reminderDate+'T'+(t.reminderTime||'00:00'));
    const trigger = target - (parseInt(t.notifyBefore)||0)*60000;
    if (now >= trigger) {
      t.notified = true;
      saveTasks();
      showReminderPopup(t);
      if (typeof Notification!=='undefined' && Notification.permission==='granted') {
        try { new Notification('⏰ TaskFlow', { body: t.title }); } catch(e) {}
      }
    }
  });
}

function showReminderPopup(t) {
  $('reminder-popup-text').textContent = t.title + (t.description ? ' — '+t.description : '');
  $('reminder-popup-time').textContent = formatDateTime(t.reminderDate, t.reminderTime);
  $('reminder-popup').classList.remove('reminder-hidden');
  $('reminder-overlay').classList.remove('reminder-hidden');
}
function dismissReminderPopup() {
  $('reminder-popup').classList.add('reminder-hidden');
  $('reminder-overlay').classList.add('reminder-hidden');
}

// ============================================================
// TOAST
// ============================================================
function showToast(message, type='info') {
  const icons = {success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${message}</span>`;
  $('toast-container').appendChild(toast);
  setTimeout(() => { if(toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
}

// ============================================================
// NOTIFICATION PERMISSION
// ============================================================
function requestNotifPermission() {
  if (typeof Notification!=='undefined' && Notification.permission==='default') {
    Notification.requestPermission().catch(()=>{});
  }
}

// ============================================================
// SVG GRADIENT
// ============================================================
function injectSvgGradient() {
  const svg = document.querySelector('.progress-ring');
  if (!svg) return;
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML = `<linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" style="stop-color:#7c6ff7"/>
    <stop offset="100%" style="stop-color:#4fb3f7"/>
  </linearGradient>`;
  svg.insertBefore(defs, svg.firstChild);
}

// ============================================================
// SAMPLE DATA (first run only)
// ============================================================
function maybeLoadSampleData() {
  if (tasks.length > 0) return;
  const tomorrow = (() => { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]; })();
  const twoH     = (() => { const d=new Date(); d.setHours(d.getHours()+2); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; })();

  tasks = [
    { id:generateId(), type:'daily',    title:'Morning Exercise 🏃',    description:'30 min cardio or yoga',          priority:'high',   repeatDays:[1,2,3,4,5], dailyTime:'07:00', completed:false, createdAt:Date.now()-5000 },
    { id:generateId(), type:'daily',    title:'Read for 20 minutes 📚', description:'Fiction or non-fiction',         priority:'medium', repeatDays:[0,1,2,3,4,5,6], completed:false, createdAt:Date.now()-4000 },
    { id:generateId(), type:'daily',    title:'Drink 8 glasses of water 💧',                                          priority:'medium', repeatDays:[0,1,2,3,4,5,6], completed:false, createdAt:Date.now()-3000 },
    { id:generateId(), type:'todo',     title:'Finish project report',  description:'Include Q1 financials',          priority:'high',   dueDate:tomorrow, completed:false, createdAt:Date.now()-2000 },
    { id:generateId(), type:'todo',     title:'Buy groceries 🛒',       description:'Milk, eggs, bread, fruits',      priority:'medium', dueDate:getTodayStr(), completed:false, createdAt:Date.now()-1500 },
    { id:generateId(), type:'reminder', title:'Assignment Submission 📝',description:'Upload to university portal',   priority:'high',   reminderDate:'2026-04-09', reminderTime:'13:00', notifyBefore:30, notified:false, completed:false, createdAt:Date.now()-1000 },
    { id:generateId(), type:'reminder', title:'Team Meeting 🤝',         description:'Weekly sync with dev team',     priority:'medium', reminderDate:tomorrow,      reminderTime:twoH,    notifyBefore:15, notified:false, completed:false, createdAt:Date.now()-500  },
  ];
  saveTasks();
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function initEvents() {

  // --- LOGIN SCREEN ---

  // Login pin keys
  document.querySelectorAll('.pin-key:not(.setup-pin-key):not(.pin-clear):not(.pin-ok)').forEach(btn => {
    btn.addEventListener('click', () => loginAddDigit(btn.dataset.val));
  });
  $('pin-clear-btn').addEventListener('click', loginBackspace);
  $('pin-ok-btn').addEventListener('click',    () => { if (loginPin.length===4) attemptLogin(); });

  // Setup pin keys
  document.querySelectorAll('.setup-pin-key').forEach(btn => {
    btn.addEventListener('click', () => setupAddDigit(btn.dataset.val));
  });
  $('setup-clear-btn').addEventListener('click', setupBackspace);
  $('setup-ok-btn').addEventListener('click',    () => { if (setupPin.length===4) advanceSetup(); });

  $('show-setup-btn').addEventListener('click',    showRegisterView);
  $('back-to-login-btn').addEventListener('click', showLoginView);

  // Keyboard PIN entry
  document.addEventListener('keydown', e => {
    const loginVisible = !$('login-screen').classList.contains('hidden');
    if (!loginVisible) return;
    if (e.key >= '0' && e.key <= '9') {
      if (currentView === 'register') setupAddDigit(e.key);
      else loginAddDigit(e.key);
    }
    if (e.key === 'Backspace') {
      if (currentView === 'register') setupBackspace();
      else loginBackspace();
    }
    if (e.key === 'Enter') {
      if (currentView === 'register') { if (setupPin.length === 4) advanceSetup(); }
      else { if (loginPin.length === 4) attemptLogin(); }
    }
  });

  // --- APP ---

  // Nav (desktop)
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // Nav (mobile bottom)
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // Add task buttons
  $('add-task-btn').addEventListener('click', openModal);
  $('fab-btn').addEventListener('click',      openModal);

  // Modal
  $('modal-close-btn').addEventListener('click',  closeModal);
  $('modal-cancel-btn').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeModal();
  });
  $('modal-save-btn').addEventListener('click', saveTask);
  $('task-title-input').addEventListener('keydown', e => { if (e.key==='Enter') saveTask(); });

  // Type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => setType(btn.dataset.type));
  });

  // Priority buttons
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', () => setPriority(btn.dataset.priority));
  });

  // Day selector in modal
  document.querySelectorAll('#day-selector .day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseInt(btn.dataset.day);
      const i = selectedDays.indexOf(d);
      if (i !== -1) selectedDays.splice(i, 1); else selectedDays.push(d);
      renderDayBtns();
    });
  });

  // To-Do filters
  $('todo-search').addEventListener('input', e => {
    todoSearch = e.target.value.toLowerCase();
    renderTodo();
  });
  $('todo-filter-priority').addEventListener('change', e => {
    todoFilterPriority = e.target.value;
    renderTodo();
  });
  $('todo-sort').addEventListener('change', e => {
    todoSort = e.target.value;
    renderTodo();
  });

  // Daily day filter
  document.querySelectorAll('.day-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.day-filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      dailyDayFilter = parseInt(btn.dataset.day);
      renderDaily();
    });
  });

  // Reminder filter
  document.querySelectorAll('.reminder-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.reminder-filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      reminderFilter = btn.dataset.filter;
      renderReminders();
    });
  });

  // Clear completed
  $('clear-completed-btn').addEventListener('click', () => {
    if (confirm('Clear all completed tasks?')) clearCompleted();
  });

  // Change PIN button
  $('change-pin-btn').addEventListener('click',    openChangePinModal);
  $('pin-modal-close-btn').addEventListener('click', closeChangePinModal);
  $('pin-modal-cancel-btn').addEventListener('click', closeChangePinModal);
  $('pin-modal-save-btn').addEventListener('click',   saveNewPin);

  // Lock buttons
  $('lock-btn').addEventListener('click',         lockApp);
  $('sidebar-logout-btn').addEventListener('click', lockApp);

  // Reminder popup
  $('reminder-dismiss-btn').addEventListener('click', dismissReminderPopup);
  $('reminder-overlay').addEventListener('click',     dismissReminderPopup);

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('task-modal').classList.contains('modal-hidden'))       closeModal();
      if (!$('pin-change-modal').classList.contains('modal-hidden')) closeChangePinModal();
      if (!$('reminder-popup').classList.contains('reminder-hidden')) dismissReminderPopup();
    }
  });
}

// ============================================================
// INIT
// ============================================================
function init() {
  initEvents();
  initLoginScreen();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(checkReminders, 30000);

  // Purge old daily completions (>7 days)
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-7);
  Object.keys(dailyCompletions).forEach(key => {
    const datePart = key.split('_').slice(-1)[0];
    if (datePart && new Date(datePart) < cutoff) delete dailyCompletions[key];
  });
  saveCompletions();
}

document.addEventListener('DOMContentLoaded', init);
