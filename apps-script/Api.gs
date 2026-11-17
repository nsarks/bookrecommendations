/**
 * The backend. Deployed as a web app; the phone app sends it JSON like
 *   { "passcode": "...", "action": "list", "user": "Sophie" }
 * and always gets back JSON: { "ok": true, ... } or { "ok": false, "error": "..." }.
 *
 * Actions:
 *   list    { user }                              -> { books: [...] }
 *   upsert  { user, book, originalTitle? }        -> { book, created }
 *   delete  { user, title }                       -> { deleted: true }
 *
 * Books are matched by title, ignoring case, spacing and punctuation (normKey),
 * so the same book can never be added twice.
 * Secrets live in Project Settings -> Script Properties: PASSCODE (and later GEMINI_API_KEY).
 */
var USERS = ['Sophie', 'Nick'];

function doGet() {
  return json_({ ok: true, app: 'Our Reading Library', message: 'Backend is running.' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Request was not valid JSON.' });
  }
  return json_(handle_(req));
}

function handle_(req) {
  try {
    checkPasscode_(req.passcode);
    if (req.action === 'ping') return { ok: true };
    var sheet = userSheet_(req.user);
    switch (req.action) {
      case 'list': return { ok: true, books: listBooks_(sheet) };
      case 'upsert': return withLock_(function () { return upsertBook_(sheet, req.book || {}, req.originalTitle); });
      case 'delete': return withLock_(function () { return deleteBook_(sheet, req.title); });
      default: throw new Error('Unknown action "' + req.action + '".');
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- security ----------

function checkPasscode_(given) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= 20) throw new Error('Too many wrong passcodes. Try again in 10 minutes.');
  var real = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!real) throw new Error('No PASSCODE set in Script Properties.');
  if (String(given || '') !== real) {
    cache.put('fails', String(fails + 1), 600);
    throw new Error('Wrong passcode.');
  }
}

function userSheet_(user) {
  if (USERS.indexOf(user) === -1) throw new Error('Unknown user.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(user);
  if (!sh) throw new Error('No "' + user + '" tab in the Sheet.');
  return sh;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- books ----------

function cols_(sheet) {
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var c = {};
  HEADERS.forEach(function (h) {
    var i = head.indexOf(h);
    if (i === -1) throw new Error('Column "' + h + '" is missing from the ' + sheet.getName() + ' tab.');
    c[h] = i;
  });
  return c;
}

function rowToBook_(r, c) {
  return {
    title: String(r[c.Title]).trim(),
    author: String(r[c.Author]).trim(),
    rating: r[c.Rating] === '' ? null : Number(r[c.Rating]),
    commentary: String(r[c.Commentary]),
    status: String(r[c.Status]),
    added: iso_(r[c.Added]),
    updated: iso_(r[c.Updated]),
    attention: String(r[c['Needs attention']] || '')
  };
}

function iso_(d) {
  return d instanceof Date ? d.toISOString() : (d ? String(d) : null);
}

function listBooks_(sheet) {
  var c = cols_(sheet);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .filter(function (r) { return String(r[c.Title]).trim() !== ''; })
    .map(function (r) { return rowToBook_(r, c); });
}

/** Returns the sheet row number (2+) of a title, or 0 if not found. */
function findRow_(sheet, c, title) {
  var key = normKey(title);
  if (!key || sheet.getLastRow() < 2) return 0;
  var titles = sheet.getRange(2, c.Title + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < titles.length; i++) {
    if (normKey(titles[i][0]) === key) return i + 2;
  }
  return 0;
}

function validate_(b) {
  var title = tidySpaces(b.title);
  if (!title) throw new Error('A title is needed.');
  if (STATUSES.indexOf(b.status) === -1) throw new Error('Status must be Read, TBR or Stopped Reading.');
  var rating = (b.rating === null || b.rating === undefined || b.rating === '') ? '' : Number(b.rating);
  if (rating !== '' && !(rating >= 1 && rating <= 10 && Math.round(rating) === rating)) {
    throw new Error('Score must be a whole number from 1 to 10.');
  }
  if (b.status === 'Read' && rating === '') throw new Error('A score is needed for books you have read.');
  return {
    title: title,
    author: tidySpaces(b.author),
    rating: rating,
    commentary: String(b.commentary || '').trim(),
    status: b.status
  };
}

function upsertBook_(sheet, input, originalTitle) {
  var b = validate_(input);
  var c = cols_(sheet);
  var width = sheet.getLastColumn();
  var now = new Date();
  var row = findRow_(sheet, c, originalTitle || b.title);

  // Renaming a book onto a title that already exists would make a duplicate.
  if (row && originalTitle && normKey(originalTitle) !== normKey(b.title) && findRow_(sheet, c, b.title)) {
    throw new Error('"' + b.title + '" is already in your library.');
  }

  if (row) {
    var r = sheet.getRange(row, 1, 1, width).getValues()[0];
    if (originalTitle) {                 // full edit from the Library tab
      r[c.Title] = b.title;
      if (b.author) r[c.Author] = b.author;
    }
    r[c.Rating] = b.rating;
    r[c.Commentary] = b.commentary;
    r[c.Status] = b.status;
    r[c.Updated] = now;
    r[c['Needs attention']] = '';
    sheet.getRange(row, 1, 1, width).setValues([r]);
    return { ok: true, created: false, book: rowToBook_(r, c) };
  }

  if (originalTitle) throw new Error('Could not find "' + originalTitle + '" to update.');
  if (!b.author) throw new Error('An author is needed for a new book.');
  var nr = new Array(width).fill('');
  nr[c.Title] = b.title;
  nr[c.Author] = b.author;
  nr[c.Rating] = b.rating;
  nr[c.Commentary] = b.commentary;
  nr[c.Status] = b.status;
  nr[c.Added] = now;
  nr[c.Updated] = now;
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, width).setValues([nr]);
  return { ok: true, created: true, book: rowToBook_(nr, c) };
}

function deleteBook_(sheet, title) {
  var row = findRow_(sheet, cols_(sheet), title);
  if (!row) throw new Error('Could not find "' + title + '" to delete.');
  sheet.deleteRow(row);
  return { ok: true, deleted: true };
}

// ---------- run this from the editor to check everything works ----------

function testBackend() {
  var pass = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  var log = function (label, res) { Logger.log(label + ': ' + JSON.stringify(res).slice(0, 300)); };
  log('Wrong passcode (should fail)', handle_({ passcode: 'nope', action: 'list', user: 'Nick' }));
  log('Sophie list', { count: handle_({ passcode: pass, action: 'list', user: 'Sophie' }).books.length });
  log('Add test book', handle_({ passcode: pass, action: 'upsert', user: 'Nick',
    book: { title: 'Test Book ', author: 'Test Author', status: 'TBR' } }));
  log('Same title, different spacing (should update, not add)', handle_({ passcode: pass, action: 'upsert',
    user: 'Nick', book: { title: 'test   book!', rating: 8, commentary: 'Lovely', status: 'Read' } }));
  log('Nick list', handle_({ passcode: pass, action: 'list', user: 'Nick' }));
  log('Delete test book', handle_({ passcode: pass, action: 'delete', user: 'Nick', title: 'Test Book' }));
  CacheService.getScriptCache().remove('fails');
}
