/**
 * The librarian: builds a prompt from the user's library and asks Gemini for
 * three recommendations. Uses the free tier only (no billing is ever linked).
 *
 * Script Properties:
 *   GEMINI_API_KEY  (required)  from aistudio.google.com
 *   GEMINI_MODEL    (optional)  your preferred model; run testGemini() to see what's available.
 *                               If it's busy, FALLBACK_MODELS are tried in turn.
 */
var DEFAULT_MODEL = 'gemini-flash-latest';
// Tried in order if your chosen model is busy, out of free quota or missing.
var FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];
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

  var reply, excluded = [];
  for (var attempt = 0; attempt < 2; attempt++) {
    reply = callGemini_(librarianSystem_(user),
      librarianMessage_(user, steer, books, fresh, noAuthor, lastChat, excluded), librarianSchema_());
    var dupes = (reply.recommendations || []).filter(function (r) { return owned[normKey(r.title)]; });
    if (!dupes.length) break;
    excluded = excluded.concat(dupes.map(function (r) { return r.title; }));
  }
  // Belt and braces: never show a book they already have.
  reply.recommendations = (reply.recommendations || []).filter(function (r) { return !owned[normKey(r.title)]; });

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
    'TASK: Recommend exactly 3 books, in this order:',
    '1-2. Two "Safe Bet" picks that sit right in ' + name + '\'s sweet spot, based on their highest-rated books.',
    '3. One "Wildcard": something a bit different that a bookseller friend thinks ' + name + ' is ready for. Say why it departs from their usual taste but will still appeal.',
    'If ' + name + ' gives a steer (for example non-fiction), respect it while keeping this structure.',
    'Never recommend a book that is already in the library, whatever its status. Only recommend real, published books, with the correct author.',
    '',
    'OUTPUT FIELDS:',
    '- greeting: 1-2 friendly, familiar sentences that use ' + name + '\'s name, such as "Lovely to hear from you, ' + name + '!" or "Hope you\'ve been having a good reading week, ' + name + '." Vary it.',
    '- newBooksComment: if any books are listed as NEW SINCE LAST CHAT, comment warmly and specifically on them, e.g. "Oh, I see you\'ve added [Book Title] to your TBR, that\'s a cracking choice, I think you\'ll find the prose quite striking." If none are listed, return an empty string.',
    '- recommendations: title, author, type ("Safe Bet" or "Wildcard") and pitch (2-4 sentences, specific, linking to books in their library).',
    '- closing: explain your logic in this style: "I\'ve picked these because I know you loved the atmosphere in [Book A], and I\'ve steered clear of [Element] since I saw you didn\'t get on with [Book B]." Name real books from the library.',
    '- missingAuthors: for each title listed under MISSING AUTHORS, give its author if you are confident. Leave out any you are unsure of.',
    '',
    'Keep it conversational and concise. Plain text only, no markdown.'
  ].join('\n');
}

function librarianMessage_(name, steer, books, fresh, noAuthor, lastChat, excluded) {
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
  if (excluded.length) {
    parts.push('You previously suggested these, but they are ALREADY IN THE LIBRARY, so choose different books: ' + excluded.join('; '));
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

/**
 * Tries your chosen model first, then the fallbacks. Busy (503/500) gets one
 * retry after a pause; a model that is busy, out of free quota or missing is
 * skipped in favour of the next one.
 */
function geminiModels_() {
  var chosen = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  var list = [chosen].concat(FALLBACK_MODELS);
  return list.filter(function (m, i) { return list.indexOf(m) === i; });
}

function callGemini_(system, message, schema) {
  var payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 1 }
  });
  var codes = [];
  var models = geminiModels_();
  for (var m = 0; m < models.length; m++) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var res = UrlFetchApp.fetch(GEMINI_BASE + 'models/' + models[m] + ':generateContent', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': geminiKey_() },
        muteHttpExceptions: true,
        payload: payload
      });
      var code = res.getResponseCode();
      if (code === 200) {
        lastModelUsed = models[m];
        var data = JSON.parse(res.getContentText());
        var parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
        var text = parts.filter(function (p) { return !p.thought && p.text; }).map(function (p) { return p.text; }).join('');
        if (!text) throw new Error('The librarian was lost for words. Please try again.');
        return JSON.parse(text);
      }
      codes.push(models[m] + ': ' + code);
      Logger.log('Gemini ' + models[m] + ' returned ' + code + ': ' + res.getContentText().slice(0, 200));
      if ((code === 503 || code === 500) && attempt === 0) { Utilities.sleep(2000); continue; }
      break;   // 429 (quota), 404 (not found) or still busy: try the next model
    }
  }
  if (codes.every(function (c) { return / 429$/.test(c); })) {
    throw new Error('The librarian is a little busy (free daily or per-minute limit reached). Please try again in a minute or two.');
  }
  if (codes.some(function (c) { return / (503|500|429)$/.test(c); })) {
    throw new Error('Google’s servers are very busy just now. Please try again in a minute or two.');
  }
  throw new Error('The librarian could not be reached (' + codes.join(', ') + '). Run testGemini() in Apps Script for details.');
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
