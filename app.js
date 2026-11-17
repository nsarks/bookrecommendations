/* Our Reading Library – front end. Plain JavaScript, no build step. */
'use strict';

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
// Same rule as the backend: ignore case, spacing, punctuation and accents.
const normKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const sorry = (name) => `So sorry, ${name}! I'm having a spot of trouble reaching your library on the shelf. Could you try again in a moment?`;

// ---------- state ----------
const S = {
  cfg: store.get('rl.cfg'),          // { url, passcode }
  user: store.get('rl.user'),        // 'Sophie' | 'Nick'
  books: [],
  filter: 'All',
  q: '',
  tab: 'library'
};

// ---------- backend ----------
async function api(action, payload = {}) {
  if (!S.cfg) throw new Error('Not connected.');
  let res;
  try {
    res = await fetch(S.cfg.url, {
      method: 'POST',
      // text/plain keeps this a "simple" request, which Apps Script can answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action, passcode: S.cfg.passcode })
    });
  } catch (e) {
    const err = new Error('Could not reach the library. Check your internet connection.');
    err.code = 'network';
    throw err;
  }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('The library sent back something unexpected.'); }
  if (!data.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.code = data.code;
    throw err;
  }
  return data;
}

// ---------- screens ----------
function show(viewId) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== viewId; });
}

function start() {
  if (!S.cfg) return showConnect();
  if (!S.user) return showPick();
  showApp();
}

function showConnect() {
  $('who').hidden = true;
  $('tabs').hidden = true;
  $('cfg-url').value = S.cfg ? S.cfg.url : '';
  $('cfg-pass').value = S.cfg ? S.cfg.passcode : '';
  $('connect-msg').textContent = '';
  show('view-connect');
}

function showPick() {
  $('who').hidden = true;
  $('tabs').hidden = true;
  show('view-pick');
}

function showApp() {
  $('who-name').textContent = S.user;
  $('who').hidden = false;
  $('tabs').hidden = false;
  goTab(S.tab);
  showSavedReply();
  loadBooks();
}

function goTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  show('view-' + tab);
  window.scrollTo(0, 0);
}

// ---------- library ----------
async function loadBooks() {
  const cacheKey = 'rl.books.' + S.user;
  const cached = store.get(cacheKey);
  if (cached) { S.books = cached; renderBooks(); }
  else { $('book-list').innerHTML = ''; $('lib-note').textContent = 'Fetching your shelf…'; }

  const userAtStart = S.user;
  try {
    const data = await api('list', { user: S.user });
    if (S.user !== userAtStart) return;        // switched user mid-load
    S.books = data.books;
    store.set(cacheKey, S.books);
    renderBooks();
  } catch (e) {
    if (S.user !== userAtStart) return;
    if (cached) {
      $('lib-note').textContent = 'Showing your saved copy – couldn’t refresh just now.';
    } else {
      $('lib-note').textContent = '';
      $('book-list').innerHTML = `<li class="sorry"><p>${esc(sorry(S.user))}</p>
        <button type="button" class="primary" id="retry">Try again</button>
        <p class="muted small">${esc(e.message)}</p></li>`;
      $('retry').onclick = loadBooks;
    }
  }
}

function sortedBooks() {
  return S.books.slice().sort((a, b) =>
    String(b.updated || '').localeCompare(String(a.updated || '')) || a.title.localeCompare(b.title));
}

function renderBooks() {
  refreshSuggestions();
  refreshRecButtons();
  const q = normKey(S.q);
  const list = sortedBooks().filter((b) =>
    (S.filter === 'All' || b.status === S.filter) &&
    (!q || normKey(b.title + ' ' + b.author).includes(q)));

  const total = S.books.length;
  $('lib-note').textContent = total === 0 ? '' :
    `${list.length} of ${total} book${total === 1 ? '' : 's'}`;

  if (total === 0) {
    $('book-list').innerHTML = `<li class="empty muted">Your shelf is empty for now.<br>Tap <b>Add</b> to put your first book on it.</li>`;
    return;
  }
  if (list.length === 0) {
    $('book-list').innerHTML = `<li class="empty muted">No books match.</li>`;
    return;
  }
  $('book-list').innerHTML = list.map((b) => `
    <li><button type="button" class="book" data-key="${esc(normKey(b.title))}">
      <span class="t">${esc(b.title)}</span>
      <span class="a">${b.author ? esc(b.author) : '<span class="unknown">Author unknown</span>'}${b.attention ? ' <span class="flagdot" title="Needs attention">⚑</span>' : ''}</span>
      <span class="side">
        ${scoreHtml(b)}
        <span class="pill ${b.status.split(' ')[0]}">${esc(b.status)}</span>
      </span>
    </button></li>`).join('');
}

function scoreHtml(b, long) {
  return b.rating ? `<span class="score">${b.rating}/10</span>` : `<span class="score none">${long ? 'No score' : '–'}</span>`;
}

// ---------- book detail ----------
const D = { book: null, score: null, busy: false };

function openDetail(key) {
  const b = S.books.find((x) => normKey(x.title) === key);
  if (!b) return;
  renderDetail(b);
  showPanel(null);
  $('detail').showModal();
}

function renderDetail(b) {
  D.book = b;
  $('d-title').textContent = b.title;
  $('d-author').textContent = b.author || 'Author unknown';
  $('d-author').classList.toggle('unknown', !b.author);
  $('d-status').textContent = b.status;
  $('d-status').className = 'pill ' + b.status.split(' ')[0];
  $('d-score').outerHTML = scoreHtml(b, true).replace('<span ', '<span id="d-score" ');
  $('d-flag').hidden = !b.attention;
  $('d-flag').textContent = b.attention ? '⚑ ' + b.attention : '';
  $('d-comment').textContent = b.commentary || 'No commentary yet.';
  $('d-comment').classList.toggle('muted', !b.commentary);
  const added = fmtDate(b.added), updated = fmtDate(b.updated);
  $('d-dates').textContent = added ? `Added ${added}` + (updated && updated !== added ? ` · Updated ${updated}` : '') : '';
  $('d-markread').hidden = b.status !== 'TBR';
  $('p-delete-title').textContent = b.title;
  document.querySelectorAll('#p-status-opts button').forEach((x) => { x.disabled = x.dataset.status === b.status; });
}

/** Shows one of the panels ('status', 'read', 'delete'), or the main buttons when null. */
function showPanel(name) {
  $('d-actions').hidden = !!name;
  ['status', 'read', 'delete'].forEach((p) => { $('p-' + p).hidden = p !== name; });
  $('d-msg').hidden = true;
  if (name === 'read') {
    setReadScore(D.book.rating || null);
    $('p-read-comment').value = D.book.commentary || '';
  }
}

function setReadScore(n) {
  D.score = n;
  document.querySelectorAll('#p-read-score button').forEach((x) => x.classList.toggle('on', Number(x.dataset.score) === n));
}

function setBusy(on) {
  D.busy = on;
  document.querySelectorAll('#detail button').forEach((x) => {
    if (x.id === 'detail-close') return;
    if (on) { x.dataset.wasDisabled = x.disabled; x.disabled = true; }
    else { x.disabled = x.dataset.wasDisabled === 'true'; }
  });
}

function detailError(text) {
  $('d-msg').textContent = `Couldn’t save just now – please try again. (${text})`;
  $('d-msg').hidden = false;
}

async function saveDetail(changes, message) {
  if (D.busy) return;
  const b = D.book;
  setBusy(true);
  try {
    const res = await api('upsert', { user: S.user, book: {
      title: b.title, author: b.author, rating: b.rating, commentary: b.commentary, status: b.status, ...changes } });
    const i = S.books.findIndex((x) => normKey(x.title) === normKey(b.title));
    if (i >= 0) S.books[i] = res.book;
    store.set('rl.books.' + S.user, S.books);
    renderBooks();
    setBusy(false);
    renderDetail(res.book);
    showPanel(null);
    toast(message);
  } catch (err) {
    setBusy(false);
    detailError(err.message);
  }
}

async function deleteDetail() {
  if (D.busy) return;
  const b = D.book;
  setBusy(true);
  try {
    await api('delete', { user: S.user, title: b.title });
    S.books = S.books.filter((x) => normKey(x.title) !== normKey(b.title));
    store.set('rl.books.' + S.user, S.books);
    renderBooks();
    setBusy(false);
    $('detail').close();
    toast('Deleted');
  } catch (err) {
    setBusy(false);
    $('d-msg').textContent = `Couldn’t delete just now – please try again. (${err.message})`;
    $('d-msg').hidden = false;
  }
}

// ---------- add / update form ----------
// mode: 'add' (new book), 'update' (title matches an existing book), 'edit' (full edit from Library)
const F = { mode: 'add', match: null, originalTitle: null, score: null, status: 'Read', saving: false };

function buildScores() {
  $('f-score').innerHTML = Array.from({ length: 10 }, (_, i) =>
    `<button type="button" data-score="${i + 1}" aria-pressed="false">${i + 1}</button>`).join('');
}

function setScore(n) {
  F.score = n;
  document.querySelectorAll('#f-score button').forEach((b) => {
    const on = Number(b.dataset.score) === n;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
}

function setStatus(s) {
  F.status = s;
  document.querySelectorAll('#f-status button').forEach((b) => b.classList.toggle('on', b.dataset.status === s));
  $('score-hint').textContent = s === 'Read' ? '(needed for Read)' : '(optional)';
}

function setFormLabels() {
  const labels = {
    add: ['Add a book', 'Add book'],
    update: ['Update a book', 'Update book'],
    edit: ['Edit book', 'Save changes']
  }[F.mode];
  $('add-heading').textContent = labels[0];
  $('add-btn').textContent = labels[1];
  $('author-wrap').hidden = F.mode === 'update';
  $('add-cancel').hidden = F.mode !== 'edit';
}

function fillFrom(b) {
  setScore(b.rating || null);
  setStatus(b.status);
  $('f-comment').value = b.commentary || '';
}

function resetForm() {
  Object.assign(F, { mode: 'add', match: null, originalTitle: null });
  $('add-form').reset();
  setScore(null);
  setStatus('Read');
  $('dup-banner').hidden = true;
  $('add-error').hidden = true;
  setFormLabels();
}

function onTitleInput() {
  if (F.mode === 'edit') return;
  const key = normKey($('f-title').value);
  const match = key ? S.books.find((b) => normKey(b.title) === key) : null;
  if (match && match !== F.match) {
    F.mode = 'update';
    F.match = match;
    const scored = match.rating ? `scored ${match.rating}` : 'not scored yet';
    $('dup-banner').innerHTML = `Already in your library: <b>${esc(match.title)}</b>, ${scored}, ${esc(match.status)}`;
    $('dup-banner').hidden = false;
    fillFrom(match);
    setFormLabels();
  } else if (!match && F.mode === 'update') {
    F.mode = 'add';
    F.match = null;
    $('dup-banner').hidden = true;
    fillFrom({ rating: null, status: 'Read', commentary: '' });
    setFormLabels();
  }
}

/** Called from the book detail view (Edit). */
function startEdit(b) {
  resetForm();
  Object.assign(F, { mode: 'edit', originalTitle: b.title });
  $('f-title').value = b.title;
  $('f-author').value = b.author;
  fillFrom(b);
  setFormLabels();
  goTab('add');
}

function refreshSuggestions() {
  $('title-suggestions').innerHTML = S.books.map((b) => `<option value="${esc(b.title)}">`).join('');
}

function formError(text) {
  $('add-error').textContent = text;
  $('add-error').hidden = false;
}

async function submitBook(e) {
  e.preventDefault();
  if (F.saving) return;
  $('add-error').hidden = true;
  const title = $('f-title').value.trim();
  const author = $('f-author').value.trim();
  if (!title) return formError('Please add a title.');
  if (F.status === 'Read' && !F.score) return formError('Please tap a score from 1 to 10 for a book you’ve read.');

  const book = {
    title: F.mode === 'update' ? F.match.title : title,
    author: F.mode === 'update' ? F.match.author : author,
    rating: F.score,
    commentary: $('f-comment').value.trim(),
    status: F.status
  };
  const payload = { user: S.user, book };
  if (F.mode === 'edit') payload.originalTitle = F.originalTitle;

  F.saving = true;
  const btn = $('add-btn'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await api('upsert', payload);
    const oldKey = normKey(F.mode === 'edit' ? F.originalTitle : res.book.title);
    const i = S.books.findIndex((b) => normKey(b.title) === oldKey);
    if (i >= 0) S.books[i] = res.book; else S.books.push(res.book);
    store.set('rl.books.' + S.user, S.books);
    renderBooks();
    const wasEdit = F.mode === 'edit';
    resetForm();
    toast(res.created ? 'Added to your library' : 'Updated');
    if (wasEdit) goTab('library');
  } catch (err) {
    formError(`Couldn’t save just now – everything you typed is still here, so just tap “${label}” to try again. (${err.message})`);
  } finally {
    F.saving = false;
    btn.disabled = false;
    if (btn.textContent === 'Saving…') btn.textContent = label;
  }
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- recommend ----------
const R = { busy: false, timer: null, recs: [] };
const THINKING = ['Browsing the shelves…', 'Having a look at what you’ve been reading…',
  'Pulling a few favourites off the shelf…', 'Weighing up a wildcard…', 'Nearly there, just wrapping them up…'];

async function askLibrarian(e) {
  e.preventDefault();
  if (R.busy) return;
  const steer = $('rec-steer').value.trim();
  R.busy = true;
  $('rec-btn').disabled = true;
  $('rec-error').hidden = true;
  $('rec-reply').hidden = true;
  $('rec-loading').hidden = false;
  let i = 0;
  $('rec-loading-text').textContent = THINKING[0];
  R.timer = setInterval(() => { i = Math.min(i + 1, THINKING.length - 1); $('rec-loading-text').textContent = THINKING[i]; }, 3000);
  const userAtStart = S.user;
  try {
    const data = await api('recommend', { user: S.user, steer });
    if (S.user !== userAtStart) return;
    const saved = { reply: data.reply, steer, at: new Date().toISOString() };
    store.set('rl.reply.' + S.user, saved);
    renderReply(saved);
    $('rec-reply').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (data.authorsFilled) loadBooks();     // pick up authors the librarian filled in
  } catch (err) {
    if (S.user !== userAtStart) return;
    showRecError(err);
  } finally {
    clearInterval(R.timer);
    R.busy = false;
    $('rec-btn').disabled = false;
    $('rec-loading').hidden = true;
  }
}

function showRecError(err) {
  let html;
  if (err.code === 'library' || err.code === 'network') {
    html = `<p>${esc(sorry(S.user))}</p>`;      // never guess tastes without the library
  } else if (err.code === 'empty') {
    html = `<p>I’d love to help, ${esc(S.user)}! Add a few books you’ve read, with scores, so I can get to know your taste first.</p>`;
  } else {
    html = `<p>The librarian’s having a little moment, ${esc(S.user)}. ${esc(err.message)}</p>`;
  }
  $('rec-error').innerHTML = html + `<button type="button" class="primary" id="rec-retry">Try again</button>`;
  $('rec-error').hidden = false;
  $('rec-retry').onclick = () => $('rec-form').requestSubmit();
}

function renderReply(saved) {
  const r = saved.reply;
  R.recs = r.recommendations || [];
  const intro = [r.greeting, r.newBooksComment].filter(Boolean).map((t) => `<p class="say">${esc(t)}</p>`).join('');
  $('rec-reply').innerHTML =
    (intro ? `<div class="card">${intro}</div>` : '') +
    R.recs.map((x, i) => `
      <div class="rec ${x.type === 'Wildcard' ? 'Wildcard' : 'Safe'}">
        <span class="kind">${esc(x.type)}</span>
        <h3>${esc(x.title)}</h3>
        <p class="by">${esc(x.author)}</p>
        <p>${esc(x.pitch)}</p>
        <button type="button" data-i="${i}">Add to TBR</button>
        <p class="err" hidden></p>
      </div>`).join('') +
    (r.closing ? `<div class="card"><p class="say">${esc(r.closing)}</p></div>` : '') +
    `<p class="asked">Asked ${esc(fmtDate(saved.at))}${saved.steer ? ' · “' + esc(saved.steer) + '”' : ''}</p>`;
  $('rec-reply').hidden = false;
  refreshRecButtons();
}

function refreshRecButtons() {
  document.querySelectorAll('#rec-reply .rec button').forEach((b) => {
    const rec = R.recs[Number(b.dataset.i)];
    if (rec && S.books.some((x) => normKey(x.title) === normKey(rec.title))) {
      b.textContent = 'On your shelf ✓';
      b.classList.add('done');
      b.disabled = true;
    }
  });
}

function showSavedReply() {
  clearInterval(R.timer);
  $('rec-loading').hidden = true;
  $('rec-error').hidden = true;
  const saved = store.get('rl.reply.' + S.user);
  if (saved && saved.reply) renderReply(saved); else { R.recs = []; $('rec-reply').hidden = true; }
}

async function addRecToTbr(btn) {
  const rec = R.recs[Number(btn.dataset.i)];
  const errEl = btn.nextElementSibling;
  if (!rec || btn.disabled) return;
  if (S.books.some((x) => normKey(x.title) === normKey(rec.title))) return refreshRecButtons();
  btn.disabled = true; btn.textContent = 'Adding…'; errEl.hidden = true;
  try {
    const res = await api('upsert', { user: S.user, book: { title: rec.title, author: rec.author, status: 'TBR' } });
    S.books.push(res.book);
    store.set('rl.books.' + S.user, S.books);
    renderBooks();
    btn.textContent = 'Added to TBR ✓';
    btn.classList.add('done');
    toast('Added to your TBR');
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Add to TBR';
    errEl.textContent = 'Couldn’t add just now – please try again. (' + err.message + ')';
    errEl.hidden = false;
  }
}

// ---------- wiring ----------
buildScores();
$('add-form').addEventListener('submit', submitBook);
$('f-title').addEventListener('input', onTitleInput);
$('f-score').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const n = Number(b.dataset.score);
  setScore(F.score === n ? null : n);   // tap again to clear
});
$('f-status').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setStatus(b.dataset.status); });
$('add-cancel').addEventListener('click', () => { resetForm(); goTab('library'); });

$('connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('cfg-url').value.trim();
  const passcode = $('cfg-pass').value;
  const btn = $('connect-btn'), msg = $('connect-msg');
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) && !/^http:\/\/localhost/.test(url)) {
    msg.className = 'msg error';
    msg.textContent = 'That doesn’t look like an Apps Script address. It should end in /exec.';
    return;
  }
  btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Checking…';
  const previous = S.cfg;
  S.cfg = { url, passcode };
  try {
    await api('ping');
    store.set('rl.cfg', S.cfg);
    msg.textContent = 'Connected!';
    start();
  } catch (err) {
    S.cfg = previous;
    msg.className = 'msg error';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

document.querySelectorAll('.person').forEach((b) => b.addEventListener('click', () => {
  S.user = b.dataset.user;
  store.set('rl.user', S.user);
  S.books = []; S.q = ''; S.filter = 'All';
  $('search').value = '';
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.filter === 'All'));
  S.tab = 'library';
  resetForm();
  showApp();
}));

$('switch-user').addEventListener('click', () => { S.user = null; store.del('rl.user'); showPick(); });
$('open-settings').addEventListener('click', showConnect);
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) goTab(b.dataset.tab); });
$('search').addEventListener('input', (e) => { S.q = e.target.value; renderBooks(); });
document.querySelector('.chips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  S.filter = c.dataset.filter;
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
  renderBooks();
});
$('book-list').addEventListener('click', (e) => { const b = e.target.closest('.book'); if (b) openDetail(b.dataset.key); });
$('detail-close').addEventListener('click', () => $('detail').close());
$('p-read-score').innerHTML = Array.from({ length: 10 }, (_, i) =>
  `<button type="button" data-score="${i + 1}">${i + 1}</button>`).join('');
$('p-read-score').addEventListener('click', (e) => {
  const x = e.target.closest('button'); if (!x) return;
  const n = Number(x.dataset.score);
  setReadScore(D.score === n ? null : n);
  $('d-msg').hidden = true;
});
$('d-markread').addEventListener('click', () => showPanel('read'));
$('d-status-btn').addEventListener('click', () => showPanel('status'));
$('d-delete').addEventListener('click', () => showPanel('delete'));
$('d-edit').addEventListener('click', () => { const b = D.book; $('detail').close(); startEdit(b); });
document.querySelectorAll('#detail [data-back]').forEach((x) => x.addEventListener('click', () => showPanel(null)));
$('p-status-opts').addEventListener('click', (e) => {
  const x = e.target.closest('button'); if (!x || x.disabled) return;
  const status = x.dataset.status;
  if (status === 'Read' && !D.book.rating) return showPanel('read');   // a read book needs a score
  saveDetail({ status }, 'Moved to ' + status);
});
$('p-read-save').addEventListener('click', () => {
  if (!D.score) { $('d-msg').textContent = 'Please tap a score from 1 to 10.'; $('d-msg').hidden = false; return; }
  saveDetail({ status: 'Read', rating: D.score, commentary: $('p-read-comment').value.trim() }, 'Marked as read');
});
$('p-delete-yes').addEventListener('click', deleteDetail);
$('rec-form').addEventListener('submit', askLibrarian);
$('rec-reply').addEventListener('click', (e) => { const b = e.target.closest('.rec button'); if (b) addRecToTbr(b); });
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) $('detail').close(); });

start();

// Install support: lets the app open full screen from the home screen and work without signal.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* still works without it */ }));
}
