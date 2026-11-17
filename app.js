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
    throw new Error('Could not reach the library. Check your internet connection.');
  }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('The library sent back something unexpected.'); }
  if (!data.ok) throw new Error(data.error || 'Something went wrong.');
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
      <span class="a">${esc(b.author)}${b.attention ? ' <span class="flagdot" title="Needs attention">⚑</span>' : ''}</span>
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
function openDetail(key) {
  const b = S.books.find((x) => normKey(x.title) === key);
  if (!b) return;
  $('d-title').textContent = b.title;
  $('d-author').textContent = b.author;
  $('d-status').textContent = b.status;
  $('d-status').className = 'pill ' + b.status.split(' ')[0];
  $('d-score').outerHTML = scoreHtml(b, true).replace('<span ', '<span id="d-score" ');
  $('d-flag').hidden = !b.attention;
  $('d-flag').textContent = b.attention ? '⚑ ' + b.attention : '';
  $('d-comment').textContent = b.commentary || 'No commentary yet.';
  $('d-comment').classList.toggle('muted', !b.commentary);
  const added = fmtDate(b.added), updated = fmtDate(b.updated);
  $('d-dates').textContent = added ? `Added ${added}` + (updated && updated !== added ? ` · Updated ${updated}` : '') : '';
  $('d-actions').innerHTML = '';   // Edit / Change status / Delete arrive in a later stage
  $('detail').showModal();
}

// ---------- wiring ----------
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
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) $('detail').close(); });

start();
