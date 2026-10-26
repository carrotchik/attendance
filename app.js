const KEY = 'attendance-v1';
const emptyState = () => ({ students: [], days: {}, excused: {}, reasons: {} });
let state = emptyState();
let present = new Set();
let excused = new Set();
let reasons = {};
let lastResult = '';
let db = null;
let cloud = false;

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
const fmt = iso => iso.split('-').reverse().join('.');
const fmtShort = iso => iso.slice(8) + '.' + iso.slice(5, 7);
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  kids.forEach(k => e.append(k));
  return e;
}
function normalize(s) {
  if (!s || !Array.isArray(s.students) || !s.days) return emptyState();
  s.excused = s.excused || {};
  s.reasons = s.reasons || {};
  return s;
}

/* ---------- хранилище ---------- */
function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = 'chip' + (cls ? ' ' + cls : '');
}
let knownMonths = new Set();
const monthOf = iso => iso.slice(0, 7);
function stateMonths() { return new Set(Object.keys(state.days).map(monthOf)); }
function monthData(ym) {
  const out = { days: {}, excused: {}, reasons: {} };
  Object.keys(state.days).filter(d => monthOf(d) === ym).forEach(d => {
    out.days[d] = state.days[d];
    out.excused[d] = state.excused[d] || [];
    out.reasons[d] = state.reasons[d] || {};
  });
  return out;
}
// opts: { students: bool, months: ['2026-10'], all: bool }; без аргумента сохраняется всё
function save(opts) {
  opts = opts || { students: true, all: true };
  if (!cloud) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); setStatus('Сохранено в браузере', 'ok'); }
    catch (e) { setStatus('Не удалось сохранить', 'err'); }
    return Promise.resolve();
  }
  setStatus('Сохранение…');
  const col = db.collection('attendance');
  const batch = db.batch();
  if (opts.students) batch.set(col.doc('meta'), { students: state.students });
  const months = opts.all ? new Set([...stateMonths(), ...knownMonths]) : new Set(opts.months || []);
  // документ месяца никогда не удаляется: если в нём не осталось дней, он остаётся пустым
  months.forEach(ym => batch.set(col.doc('m_' + ym), monthData(ym)));
  return batch.commit()
    .then(() => {
      months.forEach(m => knownMonths.add(m));
      setStatus('Сохранено в облаке', 'ok');
    })
    .catch(e => setStatus('Ошибка сохранения: ' + (e.code || e.message), 'err'));
}

function startApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('date').value = todayISO();
  loadDate();
}

function initLocal() {
  $('syncLabel').textContent = 'локальный режим';
  try { state = normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { state = emptyState(); }
  setStatus('Данные в браузере');
  startApp();
}

function initCloud() {
  cloud = true;
  firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.firestore();
  $('syncLabel').textContent = 'облако';
  $('loginBtn').onclick = () => {
    $('loginMsg').textContent = '';
    firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch(e => { $('loginMsg').textContent = 'Не удалось войти: ' + (e.code || e.message); });
  };
  $('logout').onclick = () => firebase.auth().signOut().then(() => location.reload());
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) {
      $('app').hidden = true;
      $('login').hidden = false;
      $('logout').hidden = true;
      setStatus('Не выполнен вход');
      return;
    }
    $('logout').hidden = false;
    setStatus('Загрузка…');
    try {
      const snap = await db.collection('attendance').get();
      const docs = {};
      snap.forEach(d => { docs[d.id] = d.data(); });
      knownMonths = new Set();
      if (docs.meta) {
        state = emptyState();
        state.students = docs.meta.students || [];
        Object.keys(docs).filter(id => id.startsWith('m_')).forEach(id => {
          const m = docs[id];
          knownMonths.add(id.slice(2));
          Object.assign(state.days, m.days);
          Object.assign(state.excused, m.excused);
          Object.assign(state.reasons, m.reasons);
        });
      } else if (docs.main) {
        // старый формат: всё в одном документе, переносим по месяцам
        state = normalize(docs.main);
        await save();
        await db.collection('attendance').doc('main').delete();
      } else {
        state = emptyState();
        let local = null;
        try { local = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
        if (local && local.students && local.students.length && confirm('В облаке данных ещё нет. Перенести данные, сохранённые в этом браузере?')) {
          state = normalize(local);
        }
        await save();
      }
      setStatus('Подключено к облаку', 'ok');
      startApp();
    } catch (e) {
      $('app').hidden = true;
      $('login').hidden = false;
      $('loginMsg').textContent = e.code === 'permission-denied'
        ? 'Нет доступа: этот аккаунт не является владельцем.'
        : 'Ошибка загрузки: ' + (e.code || e.message);
      setStatus('Нет доступа', 'err');
      if (e.code === 'permission-denied') firebase.auth().signOut();
    }
  });
}

function absentNames(iso) {
  const ids = new Set(state.days[iso] || []);
  const up = new Set(state.excused[iso] || []);
  const why = state.reasons[iso] || {};
  return state.students.filter(s => ids.has(s.id)).sort(byName).map(s =>
    s.name + (up.has(s.id) ? ' - уп' + (why[s.id] ? ' (' + why[s.id] + ')' : '') : ''));
}

/* ---------- вкладки ---------- */
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['check', 'days', 'stats', 'students'].forEach(t => { $('tab-' + t).hidden = t !== name; });
  if (name === 'days') renderDays();
  if (name === 'stats') renderStats();
  if (name === 'students') renderStudents();
}
$('tabs').onclick = e => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); };

/* ---------- отметка ---------- */
function loadDate() {
  const iso = $('date').value;
  const saved = state.days[iso];
  if (saved) {
    const absent = new Set(saved);
    present = new Set(state.students.filter(s => !absent.has(s.id)).map(s => s.id));
    excused = new Set(state.excused[iso] || []);
    reasons = Object.assign({}, state.reasons[iso]);
    $('dateInfo').textContent = 'День уже сохранён — можно исправить';
    $('finish').textContent = 'Сохранить изменения';
  } else {
    present = new Set();
    excused = new Set();
    reasons = {};
    $('dateInfo').textContent = 'Новый день';
    $('finish').textContent = 'Завершить список';
  }
  $('resultBox').hidden = true;
  renderCheck();
}
function renderCheck() {
  const box = $('checkList');
  box.textContent = '';
  if (!state.students.length) {
    box.append(el('div', { className: 'muted', textContent: 'Список пуст. Добавьте студентов на вкладке «Студенты».' }));
    return;
  }
  state.students.slice().sort(byName).forEach(s => {
    const cb = el('input', { type: 'checkbox', checked: present.has(s.id) });
    const up = el('button', { type: 'button', className: 'up' + (excused.has(s.id) ? ' on' : ''), textContent: 'УП', title: 'Уважительная причина' });
    const why = el('input', { type: 'text', className: 'why', placeholder: 'Причина (необязательно)', value: reasons[s.id] || '' });
    why.oninput = () => { reasons[s.id] = why.value; };
    const label = el('label', { className: 'stu' + (present.has(s.id) ? '' : ' absent') + (excused.has(s.id) ? ' isup' : '') },
      cb, el('span', { className: 'grow name', textContent: s.name }), up, why);
    cb.onchange = () => {
      cb.checked ? present.add(s.id) : present.delete(s.id);
      label.classList.toggle('absent', !cb.checked);
    };
    up.onclick = e => {
      e.preventDefault();
      excused.has(s.id) ? excused.delete(s.id) : excused.add(s.id);
      up.classList.toggle('on', excused.has(s.id));
      label.classList.toggle('isup', excused.has(s.id));
      if (excused.has(s.id)) why.focus();
    };
    box.append(label);
  });
}
$('date').onchange = loadDate;
$('allPresent').onclick = () => { present = new Set(state.students.map(s => s.id)); renderCheck(); };
$('nonePresent').onclick = () => { present = new Set(); renderCheck(); };
$('finish').onclick = () => {
  const iso = $('date').value;
  if (!iso) return alert('Выберите дату');
  if (!state.students.length) return;
  state.days[iso] = state.students.filter(s => !present.has(s.id)).map(s => s.id);
  state.excused[iso] = state.days[iso].filter(id => excused.has(id));
  state.reasons[iso] = {};
  state.excused[iso].forEach(id => { const t = (reasons[id] || '').trim(); if (t) state.reasons[iso][id] = t; });
  save({ months: [monthOf(iso)] });
  const names = absentNames(iso);
  lastResult = names.length
    ? fmt(iso) + ' Отсутствуют:\n' + names.join('\n')
    : fmt(iso) + ' Все присутствуют';
  $('result').textContent = lastResult;
  $('resultBox').hidden = false;
  $('copied').textContent = '';
  $('dateInfo').textContent = 'Сохранено';
  $('finish').textContent = 'Сохранить изменения';
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(lastResult); $('copied').textContent = 'Скопировано'; }
  catch (e) { $('copied').textContent = 'Выделите текст и скопируйте вручную'; }
};

/* ---------- месяцы ---------- */
let daysMonth = null;
let statsScope = 'all';
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const monthName = ym => MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
function monthsList(withCurrent) {
  const set = stateMonths();
  if (withCurrent) set.add(monthOf(todayISO()));
  return [...set].sort();
}
function monthBar(months, value, onChange, withAll) {
  const sel = el('select', { className: 'monthsel' });
  if (withAll) sel.append(el('option', { value: 'all', textContent: 'Все месяцы' }));
  months.slice().reverse().forEach(m => sel.append(el('option', { value: m, textContent: monthName(m) })));
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  const i = months.indexOf(value);
  const prev = el('button', { className: 'btn small', textContent: '‹', title: 'Предыдущий месяц', disabled: i <= 0 });
  const next = el('button', { className: 'btn small', textContent: '›', title: 'Следующий месяц', disabled: i < 0 || i >= months.length - 1 });
  prev.onclick = () => onChange(months[i - 1]);
  next.onclick = () => onChange(months[i + 1]);
  return el('div', { className: 'monthbar' }, prev, sel, next);
}

/* ---------- дни ---------- */
function renderDays() {
  const box = $('daysList');
  box.textContent = '';
  const months = monthsList(true);
  if (!months.includes(daysMonth)) daysMonth = months[months.length - 1];
  box.append(monthBar(months, daysMonth, m => { daysMonth = m; renderDays(); }, false));
  const dates = Object.keys(state.days).filter(d => monthOf(d) === daysMonth).sort().reverse();
  if (!dates.length) return box.append(el('div', { className: 'muted', textContent: 'В этом месяце нет сохранённых дней.' }));
  box.append(el('div', { className: 'muted', style: 'margin-bottom:6px', textContent: 'Дней в месяце: ' + dates.length }));
  dates.forEach(iso => {
    const names = absentNames(iso);
    const edit = el('button', { className: 'btn small', textContent: 'Изменить' });
    const del = el('button', { className: 'btn small danger', textContent: 'Удалить' });
    edit.onclick = () => { $('date').value = iso; showTab('check'); loadDate(); };
    del.onclick = () => {
      if (confirm('Удалить день ' + fmt(iso) + '?')) {
        delete state.days[iso]; delete state.excused[iso]; delete state.reasons[iso];
        save({ months: [monthOf(iso)] }); renderDays();
      }
    };
    box.append(el('div', { className: 'item' },
      el('div', { className: 'grow' },
        el('strong', { textContent: fmt(iso) }),
        el('div', { className: 'muted', textContent: names.length ? 'Нет: ' + names.join(', ') : 'Все присутствовали' })),
      el('div', { className: 'actions' }, edit, del)));
  });
}

/* ---------- статистика ---------- */
function missedOf(s, dates) {
  return {
    missed: dates.filter(d => state.days[d].includes(s.id)),
    up: new Set(dates.filter(d => (state.excused[d] || []).includes(s.id)))
  };
}
function scopeDates() {
  return Object.keys(state.days).filter(d => statsScope === 'all' || monthOf(d) === statsScope).sort();
}
function renderStats(openId) {
  const box = $('statsTable');
  box.textContent = '';
  const months = monthsList(false);
  if (statsScope !== 'all' && !months.includes(statsScope)) statsScope = 'all';
  if (!months.length) {
    $('statsInfo').textContent = '';
    return box.append(el('div', { className: 'muted', textContent: 'Пока нет сохранённых дней.' }));
  }
  box.append(monthBar(months, statsScope, m => { statsScope = m; renderStats(openId); }, true));
  const dates = scopeDates();
  const stu = openId && state.students.find(x => x.id === openId);
  if (stu) return renderStudentStats(stu, dates, box, months);
  const scopeName = statsScope === 'all' ? 'все месяцы' : monthName(statsScope);
  $('statsInfo').textContent = 'Период: ' + scopeName + '. Дней в учёте: ' + dates.length + '. Нажмите на студента, чтобы увидеть даты пропусков.';
  if (!state.students.length) return;
  const total = dates.length;
  const rows = state.students.map(s => Object.assign({ id: s.id, name: s.name }, missedOf(s, dates)))
    .sort((a, b) => b.missed.length - a.missed.length || a.name.localeCompare(b.name, 'ru'));
  const table = el('table');
  table.append(el('thead', null, el('tr', null,
    el('th', { textContent: 'Студент' }),
    el('th', { className: 'num', textContent: 'Пропусков' }),
    el('th', { className: 'num', textContent: 'из них УП' }),
    el('th', { className: 'num', textContent: 'Посещ.' }))));
  const tb = el('tbody');
  rows.forEach(r => {
    const pct = total ? Math.round((1 - r.missed.length / total) * 100) + '%' : '—';
    const tr = el('tr', { className: 'clickable' },
      el('td', { textContent: r.name }),
      el('td', { className: 'num', textContent: r.missed.length }),
      el('td', { className: 'num', textContent: r.up.size }),
      el('td', { className: 'num', textContent: pct }));
    tr.onclick = () => renderStats(r.id);
    tb.append(tr);
  });
  table.append(tb);
  box.append(table);
}
function renderStudentStats(stu, dates, box, months) {
  const r = missedOf(stu, dates);
  $('statsInfo').textContent = '';
  const back = el('button', { className: 'btn small', textContent: '← Ко всем студентам' });
  back.onclick = () => renderStats();
  box.append(back, el('h2', { textContent: stu.name, style: 'margin-top:14px' }),
    el('div', { className: 'muted', textContent: (statsScope === 'all' ? 'Все месяцы' : monthName(statsScope)) +
      ': пропусков ' + r.missed.length + ', из них по УП ' + r.up.size + ', дней в учёте ' + dates.length }));
  if (statsScope === 'all' && months.length > 1) {
    const table = el('table', { style: 'margin-top:12px' });
    table.append(el('thead', null, el('tr', null,
      el('th', { textContent: 'Месяц' }),
      el('th', { className: 'num', textContent: 'Дней' }),
      el('th', { className: 'num', textContent: 'Пропусков' }),
      el('th', { className: 'num', textContent: 'УП' }))));
    const tb = el('tbody');
    months.slice().reverse().forEach(m => {
      const md = Object.keys(state.days).filter(d => monthOf(d) === m).sort();
      const mr = missedOf(stu, md);
      tb.append(el('tr', null, el('td', { textContent: monthName(m) }),
        el('td', { className: 'num', textContent: md.length }),
        el('td', { className: 'num', textContent: mr.missed.length }),
        el('td', { className: 'num', textContent: mr.up.size })));
    });
    table.append(tb);
    box.append(table);
  }
  if (!r.missed.length) return box.append(el('p', { textContent: 'Пропусков нет.' }));
  box.append(el('h2', { textContent: 'Даты пропусков', style: 'margin-top:16px' }));
  r.missed.slice().reverse().forEach(d => {
    const w = (state.reasons[d] || {})[stu.id];
    box.append(el('div', { className: 'item' },
      el('strong', { textContent: fmt(d) }),
      el('span', { className: 'grow muted', textContent: r.up.has(d) ? 'УП' + (w ? ' (' + w + ')' : '') : 'без уважительной причины' })));
  });
}

/* ---------- студенты ---------- */
function renderStudents() {
  const box = $('studentsList');
  box.textContent = '';
  if (!state.students.length) return box.append(el('div', { className: 'muted', textContent: 'Пока никого нет.' }));
  state.students.slice().sort(byName).forEach(s => {
    const ren = el('button', { className: 'btn small', textContent: 'Переименовать' });
    const del = el('button', { className: 'btn small danger', textContent: 'Удалить' });
    ren.onclick = () => {
      const n = prompt('Новое имя', s.name);
      if (n && n.trim()) { s.name = n.trim(); save({ students: true }); renderStudents(); }
    };
    del.onclick = () => {
      if (confirm('Удалить «' + s.name + '»? Его пропуски пропадут из статистики.')) {
        state.students = state.students.filter(x => x.id !== s.id);
        Object.keys(state.days).forEach(d => state.days[d] = state.days[d].filter(id => id !== s.id));
        Object.keys(state.excused).forEach(d => state.excused[d] = state.excused[d].filter(id => id !== s.id));
        save({ students: true, all: true }); renderStudents();
      }
    };
    box.append(el('div', { className: 'item' }, el('div', { className: 'grow', textContent: s.name }), el('div', { className: 'actions' }, ren, del)));
  });
}
$('addStudents').onclick = () => {
  const names = $('newNames').value.split('\n').map(x => x.trim()).filter(Boolean);
  if (!names.length) return;
  names.forEach(n => state.students.push({ id: uid(), name: n }));
  $('newNames').value = '';
  save({ students: true }); renderStudents(); loadDate();
};

/* ---------- резервная копия ---------- */
$('export').onclick = () => {
  const a = el('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })),
    download: 'attendance-' + todayISO() + '.json'
  });
  a.click();
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!Array.isArray(s.students) || typeof s.days !== 'object') throw 0;
    if (!confirm('Заменить текущие данные данными из файла?')) return;
    state = normalize(s); save(); renderStudents(); loadDate();
  } catch (err) { alert('Не удалось прочитать файл'); }
  e.target.value = '';
};

/* ---------- очистка ---------- */
$('clearAll').onclick = async () => {
  const months = new Set([...stateMonths(), ...knownMonths]);
  if (!months.size) return alert('Посещаемость уже пуста');
  if (!confirm('Будут удалены ВСЕ отметки посещаемости за все месяцы. Список студентов останется. Лучше сначала скачать копию. Продолжить?')) return;
  if ((prompt('Для подтверждения введите слово УДАЛИТЬ') || '').trim().toUpperCase() !== 'УДАЛИТЬ') return alert('Отменено');
  state.days = {}; state.excused = {}; state.reasons = {};
  if (cloud) {
    setStatus('Удаление…');
    const batch = db.batch();
    months.forEach(m => batch.delete(db.collection('attendance').doc('m_' + m)));
    try { await batch.commit(); }
    catch (e) { alert('Не удалось очистить: ' + (e.code || e.message)); return location.reload(); }
    knownMonths = new Set();
    setStatus('Посещаемость очищена', 'ok');
  } else {
    save();
  }
  daysMonth = null; statsScope = 'all';
  loadDate();
  alert('Посещаемость очищена');
};

/* ---------- старт ---------- */
if (window.FIREBASE_CONFIG && window.firebase) initCloud(); else initLocal();
