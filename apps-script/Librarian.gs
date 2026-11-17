/**
 * The librarian: builds a prompt from the user's library and asks Gemini for
 * three recommendations. Uses the free tier only (no billing is ever linked).
 *
 * Script Properties:
 *   GEMINI_API_KEY  (required)  from aistudio.google.com
 *   GEMINI_MODEL    (optional)  your preferred model; run testGemini() to see what's available.
 *                               If it fails, one fallback model is tried (see FALLBACK_MODELS).
 */
var DEFAULT_MODEL = 'gemini-flash-latest';
// If your chosen model fails, the first of these that differs from it is tried once.
var FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
var lastModelUsed = null;
var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/';

function recommend_(user, steer) {
  // CRITICAL RULE: never recommend without the real library.
  var sheet, books;
  try {
    sheet = userSheet_(user);
    books = listBooks_(sheet);
  } catch (e) {
    return { ok: false, code: 'library', error: e.message };
  }
  if (!books.length) return { ok: false, code: 'empty', error: 'The library is empty.' };

  var lastChat = getLastChat_(user);
  var fresh = books.filter(function (b) {
    return lastChat && ((b.added && new Date(b.added) > lastChat) || (b.updated && new Date(b.updated) > lastChat));
  });
  var noAuthor = books.filter(function (b) { return !b.author; });
  var owned = {};
  books.forEach(function (b) { owned[normKey(b.title)] = true; });

  // One request only. Gemini suggests 5 candidates; we show the best 2 Safe Bets
  // and best Wildcard that aren't already in the library.
  var reply = callGemini_(librarianSystem_(user),
    librarianMessage_(user, steer, books, fresh, noAuthor, lastChat), librarianSchema_());
  reply.recommendations = pickThree_(reply.recommendations || [], owned);

  withLock_(function () {
    fillAuthors_(sheet, reply.missingAuthors || [], noAuthor);
    setLastChat_(user, new Date());
  });

  return {
    ok: true,
    reply: {
      greeting: reply.greeting || '',
      newBooksComment: reply.newBooksComment || '',
      recommendations: reply.recommendations,
      closing: reply.closing || ''
    },
    authorsFilled: (reply.missingAuthors || []).length,
    model: lastModelUsed
  };
}

function pickThree_(candidates, owned) {
  var seen = {};
  var fresh = candidates.filter(function (r) {
    var k = normKey(r.title);
    if (!k || owned[k] || seen[k]) return false;
    seen[k] = true;
    return true;
  });
  var safe = fresh.filter(function (r) { return r.type !== 'Wildcard'; }).slice(0, 2);
  var wild = fresh.filter(function (r) { return r.type === 'Wildcard'; }).slice(0, 1);
  var picked = safe.concat(wild);
  fresh.forEach(function (r) { if (picked.length < 3 && picked.indexOf(r) === -1) picked.push(r); });
  return picked;
}

// ---------- prompt ----------

function librarianSystem_(name) {
  return [
    'You are ' + name + '\'s personal librarian and friend, with the warm, welcoming and knowledgeable manner of a seasoned Waterstones bookseller: familiar, enthusiastic and very well read. Always write in British English (favourite, characterisation, summarise).',
    '',
    'KNOWLEDGE SOURCE: The library you are given is the bible for ' + name + '\'s tastes. ' + name + ' does not give genres, so infer genre, sub-genre and the specific vibe of each book from its title and author.',
    '- Read: use the score (1-10) and commentary to understand core tastes. High scores show the sweet spot; low scores and critical comments show what to avoid.',
    '- TBR: shows what ' + name + ' is currently excited about.',
    '- Stopped Reading: a strong negative signal. Even without a score, avoid books with similar tropes or styles to anything mentioned in that commentary.',
    '',
    'TASK: ' + name + ' will be shown 3 books: two "Safe Bet" picks that sit right in their sweet spot, based on their highest-rated books, and one "Wildcard": something a bit different that a bookseller friend thinks ' + name + ' is ready for (say why it departs from their usual taste but will still appeal).',
    'To allow for spares, give 5 candidates in order of preference: 3 Safe Bets first, then 2 Wildcards.',
    'If ' + name + ' gives a steer (for example non-fiction), respect it while keeping this structure.',
    'Never recommend a book that is already in the library, whatever its status. Only recommend real, published books, with the correct author.',
    '',
    'OUTPUT FIELDS:',
    '- greeting: 1-2 friendly, familiar sentences that use ' + name + '\'s name, such as "Lovely to hear from you, ' + name + '!" or "Hope you\'ve been having a good reading week, ' + name + '." Vary it.',
    '- newBooksComment: if any books are listed as NEW SINCE LAST CHAT, comment warmly and specifically on them, e.g. "Oh, I see you\'ve added [Book Title] to your TBR, that\'s a cracking choice, I think you\'ll find the prose quite striking." If none are listed, return an empty string.',
    '- recommendations: title, author, type ("Safe Bet" or "Wildcard") and pitch (2-4 sentences, specific, linking to books in their library).',
    '- closing: explain your logic in this style: "I\'ve picked these because I know you loved the atmosphere in [Book A], and I\'ve steered clear of [Element] since I saw you didn\'t get on with [Book B]." Name real books from the LIBRARY, not the candidates.',
    '- missingAuthors: for each title listed under MISSING AUTHORS, give its author if you are confident. Leave out any you are unsure of.',
    '',
    'Keep it conversational and concise. Plain text only, no markdown.'
  ].join('\n');
}

function librarianMessage_(name, steer, books, fresh, noAuthor, lastChat) {
  var line = function (b) {
    return [b.title, b.author || '?', b.status, b.rating ? b.rating + '/10' : '-', b.commentary || '']
      .join(' | ').replace(/\s+/g, ' ');
  };
  var parts = [
    'Reader: ' + name,
    'Today: ' + Utilities.formatDate(new Date(), 'Europe/London', 'd MMMM yyyy'),
    'Steer: ' + (steer && String(steer).trim() ? String(steer).trim().slice(0, 300) : 'None, surprise me.'),
    ''
  ];
  parts.push('NEW SINCE LAST CHAT' + (lastChat ? '' : ' (first chat)') + ': ' + (fresh.length ? '' : 'none'));
  fresh.forEach(function (b) {
    var isNew = b.added && lastChat && new Date(b.added) > lastChat;
    parts.push('- ' + b.title + (b.author ? ' by ' + b.author : '') + ': ' +
      (isNew ? 'added as ' + b.status : 'updated, now ' + b.status) + (b.rating ? ', scored ' + b.rating + '/10' : ''));
  });
  parts.push('');
  if (noAuthor.length) {
    parts.push('MISSING AUTHORS: ' + noAuthor.map(function (b) { return b.title; }).join('; '));
    parts.push('');
  }
  parts.push('LIBRARY (' + books.length + ' books) - Title | Author | Status | Score | Commentary');
  books.forEach(function (b) { parts.push(line(b)); });
  return parts.join('\n');
}

function librarianSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      greeting: { type: 'STRING' },
      newBooksComment: { type: 'STRING' },
      recommendations: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            author: { type: 'STRING' },
            type: { type: 'STRING', enum: ['Safe Bet', 'Wildcard'] },
            pitch: { type: 'STRING' }
          },
          required: ['title', 'author', 'type', 'pitch']
        }
      },
      closing: { type: 'STRING' },
      missingAuthors: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { title: { type: 'STRING' }, author: { type: 'STRING' } },
          required: ['title', 'author']
        }
      }
    },
    required: ['greeting', 'newBooksComment', 'recommendations', 'closing']
  };
}

// ---------- Gemini ----------

function geminiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('No GEMINI_API_KEY set in Script Properties.');
  return key;
}

/** Your chosen model, then one fallback. */
function geminiModels_() {
  var chosen = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  var fallback = FALLBACK_MODELS.filter(function (m) { return m !== chosen; })[0];
  return [chosen, fallback];
}

/**
 * At most 3 requests per question, to stay within free-tier limits:
 * the chosen model, one retry after a pause if Google is busy (503/500),
 * then a single fallback model. After a quota error (429) we pause all
 * requests for a minute rather than hammering Google.
 */
function callGemini_(system, message, schema) {
  var cache = CacheService.getScriptCache();
  if (cache.get('gemini-cooldown')) {
    throw new Error('The librarian is taking a short breather after a busy spell. Please try again in a minute.');
  }
  var payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 1 }
  });
  var plan = geminiModels_();
  plan = [plan[0], plan[0], plan[1]];          // chosen, chosen again (only if busy), fallback
  var codes = [];
  for (var i = 0; i < plan.length; i++) {
    if (i === 1 && !/ (503|500)$/.test(codes[0])) continue;   // only retry the same model if it was busy
    if (i === 1) Utilities.sleep(3000);
    var res = UrlFetchApp.fetch(GEMINI_BASE + 'models/' + plan[i] + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': geminiKey_() },
      muteHttpExceptions: true,
      payload: payload
    });
    var code = res.getResponseCode();
    if (code === 200) {
      lastModelUsed = plan[i];
      var data = JSON.parse(res.getContentText());
      var parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      var text = parts.filter(function (p) { return !p.thought && p.text; }).map(function (p) { return p.text; }).join('');
      if (!text) throw new Error('The librarian was lost for words. Please try again.');
      return JSON.parse(text);
    }
    codes.push(plan[i] + ': ' + code);
    console.log('Gemini ' + plan[i] + ' returned ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  var detail = ' (' + codes.join(', ') + ')';
  if (codes.some(function (c) { return / 429$/.test(c); })) {
    cache.put('gemini-cooldown', '1', 60);
    throw new Error('The librarian is a little busy: the free per-minute or daily limit was reached. Please try again in a minute or two.' + detail);
  }
  if (codes.some(function (c) { return / (503|500)$/.test(c); })) {
    throw new Error('Google’s servers are very busy just now. Please try again in a minute or two.' + detail);
  }
  throw new Error('The librarian could not be reached' + detail + '. Run testGemini() in Apps Script for details.');
}

// ---------- memory: last chat time and missing authors ----------

function metaRow_(user) {
  var meta = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Meta');
  if (!meta) return null;
  var vals = meta.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) if (vals[i][0] === user) return { sheet: meta, row: i + 1, value: vals[i][1] };
  return { sheet: meta, row: 0, value: null };
}

function getLastChat_(user) {
  var m = metaRow_(user);
  return m && m.value instanceof Date ? m.value : null;
}

function setLastChat_(user, when) {
  var m = metaRow_(user);
  if (!m) return;
  if (m.row) m.sheet.getRange(m.row, 2).setValue(when);
  else m.sheet.appendRow([user, when]);
}

function fillAuthors_(sheet, suggestions, noAuthor) {
  if (!suggestions.length || !noAuthor.length) return;
  var wanted = {};
  noAuthor.forEach(function (b) { wanted[normKey(b.title)] = true; });
  var c = cols_(sheet);
  suggestions.forEach(function (s) {
    if (!s.author || !wanted[normKey(s.title)]) return;
    var row = findRow_(sheet, c, s.title);
    if (!row) return;
    var cell = sheet.getRange(row, c.Author + 1);
    if (String(cell.getValue()).trim()) return;   // someone filled it in meanwhile
    cell.setValue(String(s.author).trim());
    var note = sheet.getRange(row, c['Needs attention'] + 1);
    var existing = String(note.getValue() || '');
    note.setValue((existing ? existing + '; ' : '') + 'Author filled in by the librarian, please check');
  });
}

// ---------- run this from the editor to check the key and see available models ----------

function testGemini() {
  var res = UrlFetchApp.fetch(GEMINI_BASE + 'models?pageSize=200', {
    headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Key check failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
    return;
  }
  var models = (JSON.parse(res.getContentText()).models || [])
    .filter(function (m) { return /flash/.test(m.name) && (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
    .map(function (m) { return m.name.replace('models/', ''); });
  Logger.log('Flash models your key can use:\n' + models.join('\n'));
  Logger.log('Will try, in order: ' + geminiModels_().join(', '));
  var out = callGemini_('Reply in British English.', 'Say hello to a book lover in one short sentence.',
    { type: 'OBJECT', properties: { hello: { type: 'STRING' } }, required: ['hello'] });
  Logger.log('Test reply from ' + lastModelUsed + ': ' + out.hello);
}

/** Try a real recommendation from the editor without the app (does update the last-chat time). */
function testRecommend() {
  Logger.log(JSON.stringify(recommend_('Sophie', ''), null, 2));
}
