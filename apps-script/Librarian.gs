/**
 * The librarian: builds a prompt from the user's library and asks a language
 * model for recommendations. Free tiers only: no billing is ever linked.
 *
 * Script Properties (at least one key is needed):
 *   MISTRAL_API_KEY from console.mistral.ai  (asked first)
 *   GEMINI_API_KEY  from aistudio.google.com (backup)
 *   GROQ_API_KEY    from console.groq.com    (optional extra backup)
 *   MISTRAL_MODEL / GEMINI_MODEL / GROQ_MODEL  optional; run testMistral(),
 *                   testGemini() or testGroq() to see what's available
 *   LLM_ORDER       optional; default "mistral,gemini,groq" (services without a key are skipped)
 * At most 3 requests are made per question.
 */
var DEFAULT_MODEL = 'gemini-flash-latest';
// Gemini models tried after your chosen GEMINI_MODEL if it is busy or unavailable.
var FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-lite-latest'];
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
  var reply = callLLM_(librarianSystem_(user),
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

// ---------- language models (Mistral first, then Gemini, then Groq) ----------

// Services that use the common "chat completions" request style.
// Models are listed best first; a missing one is skipped instantly.
var CHAT_SERVICES = {
  mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1/', key: 'MISTRAL_API_KEY', modelProp: 'MISTRAL_MODEL',
    models: ['mistral-large-latest', 'mistral-medium-latest'] },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1/', key: 'GROQ_API_KEY', modelProp: 'GROQ_MODEL',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'] }
};

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function geminiKey_() {
  var key = prop_('GEMINI_API_KEY');
  if (!key) throw new Error('No GEMINI_API_KEY set in Script Properties.');
  return key;
}

/** Which services to ask, in order. LLM_ORDER (e.g. "gemini,groq") overrides. */
function providers_() {
  var order = (prop_('LLM_ORDER') || 'mistral,gemini,groq').split(',').map(function (x) { return x.trim().toLowerCase(); });
  var keys = { mistral: prop_('MISTRAL_API_KEY'), gemini: prop_('GEMINI_API_KEY'), groq: prop_('GROQ_API_KEY') };
  order = order.filter(function (p) { return keys[p]; });
  if (!order.length) throw new Error('No MISTRAL_API_KEY or GEMINI_API_KEY set in Script Properties.');
  return order;
}

/** Your chosen Gemini model, then fallbacks. */
function geminiModels_() {
  var chosen = prop_('GEMINI_MODEL') || DEFAULT_MODEL;
  return [chosen].concat(FALLBACK_MODELS.filter(function (m) { return m !== chosen; }));
}

function chatModels_(name) {
  var svc = CHAT_SERVICES[name];
  var chosen = prop_(svc.modelProp);
  var list = (chosen ? [chosen] : []).concat(svc.models);
  return list.filter(function (m, i) { return list.indexOf(m) === i; });
}

/**
 * Asks the services in turn and returns the parsed JSON reply.
 * At most 3 requests in total. A busy (503/500) or rate-limited (429) service
 * isn't retried; we move on. After 429s everywhere we pause for a minute.
 * `only` limits it to one service (used by the test functions).
 */
function callLLM_(system, message, schema, only) {
  var cache = CacheService.getScriptCache();
  if (cache.get('llm-cooldown')) {
    throw new Error('The librarian is taking a short breather after a busy spell. Please try again in a minute.');
  }
  var order = only ? [only] : providers_();
  var codes = [];
  var budget = 3;
  for (var i = 0; i < order.length && budget > 0; i++) {
    // With a backup service available, give the first one up to 2 tries and the backup 1.
    var share = order.length > 1 ? (i === 0 ? 2 : budget) : budget;
    var res = order[i] === 'gemini'
      ? tryGemini_(system, message, schema, codes, share)
      : tryChat_(order[i], system, message, schema, codes, share);
    budget -= res.used;
    if (res.out) return res.out;
  }
  var detail = ' (' + codes.join(', ') + ')';
  if (codes.length && codes.every(function (c) { return / 429$/.test(c); })) {
    cache.put('llm-cooldown', '1', 60);
    throw new Error('The librarian is a little busy: the free per-minute or daily limit was reached. Please try again in a minute or two.' + detail);
  }
  if (codes.some(function (c) { return / (503|500|429|timeout)$/.test(c); })) {
    throw new Error('The librarian’s services are very busy just now. Please try again in a minute or two.' + detail);
  }
  throw new Error('The librarian could not be reached' + detail + '.');
}

/** Kept for testGemini(): Gemini only. */
function callGemini_(system, message, schema) { return callLLM_(system, message, schema, 'gemini'); }

function tryGemini_(system, message, schema, codes, max) {
  var payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: message }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 1 }
  });
  var models = geminiModels_().slice(0, max);
  for (var i = 0; i < models.length; i++) {
    var res = UrlFetchApp.fetch(GEMINI_BASE + 'models/' + models[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': geminiKey_() }, payload: payload
    });
    var code = res.getResponseCode();
    if (code === 200) {
      lastModelUsed = models[i];
      var data = JSON.parse(res.getContentText());
      var parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      var text = parts.filter(function (p) { return !p.thought && p.text; }).map(function (p) { return p.text; }).join('');
      if (!text) throw new Error('The librarian was lost for words. Please try again.');
      return { out: JSON.parse(text), used: i + 1 };
    }
    codes.push(models[i] + ': ' + code);
    console.log('Gemini ' + models[i] + ' returned ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  return { out: null, used: models.length };
}

function tryChat_(name, system, message, schema, codes, max) {
  var svc = CHAT_SERVICES[name];
  var models = chatModels_(name).slice(0, max);
  var used = 0;
  for (var i = 0; i < models.length; i++) {
    var body = {
      model: models[i],
      messages: [
        { role: 'system', content: system + '\n\nReply with ONLY a JSON object of exactly this shape:\n' + JSON.stringify(shapeOf_(schema)) },
        { role: 'user', content: message }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.9
    };
    if (/gpt-oss/.test(models[i])) body.reasoning_effort = 'low';
    used++;
    var res = UrlFetchApp.fetch(svc.base + 'chat/completions', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + prop_(svc.key) }, payload: JSON.stringify(body)
    });
    var code = res.getResponseCode();
    if (code === 200) {
      lastModelUsed = name + '/' + models[i];
      var content = ((((JSON.parse(res.getContentText()).choices || [])[0] || {}).message) || {}).content;
      if (Array.isArray(content)) content = content.map(function (c) { return c.text || ''; }).join('');
      if (!content) throw new Error('The librarian was lost for words. Please try again.');
      return { out: JSON.parse(content), used: used };
    }
    codes.push(name + '/' + models[i] + ': ' + code);
    console.log(svc.label + ' ' + models[i] + ' returned ' + code + ': ' + res.getContentText().slice(0, 500));
    if (code !== 404 && code !== 400) break;   // busy or rate-limited: don't hammer, move to the backup
  }
  return { out: null, used: used };
}

/** Turns the reply schema into an example JSON shape for models without schema support. */
function shapeOf_(schema) {
  if (schema.type === 'OBJECT') {
    var o = {};
    Object.keys(schema.properties).forEach(function (k) { o[k] = shapeOf_(schema.properties[k]); });
    return o;
  }
  if (schema.type === 'ARRAY') return [shapeOf_(schema.items)];
  return schema.enum ? schema.enum.join(' | ') : 'text';
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

/** Run from the editor: lists the models your Mistral key can use and sends a test hello. */
function testMistral() { testChat_('mistral'); }

/** Run from the editor: lists the models your Groq key can use and sends a test hello. */
function testGroq() { testChat_('groq'); }

function testChat_(name) {
  var svc = CHAT_SERVICES[name];
  if (!prop_(svc.key)) { Logger.log('No ' + svc.key + ' in Script Properties.'); return; }
  var res = UrlFetchApp.fetch(svc.base + 'models', {
    headers: { Authorization: 'Bearer ' + prop_(svc.key) }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Key check failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
    return;
  }
  var ids = (JSON.parse(res.getContentText()).data || []).map(function (m) { return m.id; }).sort();
  Logger.log(svc.label + ' models your key can use:\n' + ids.join('\n'));
  Logger.log('Will try, in order: ' + chatModels_(name).join(', '));
  var out = callLLM_('Reply in British English.', 'Say hello to a book lover in one short sentence.',
    { type: 'OBJECT', properties: { hello: { type: 'STRING' } }, required: ['hello'] }, name);
  Logger.log('Test reply from ' + lastModelUsed + ': ' + out.hello);
}

/** Try a real recommendation from the editor without the app (does update the last-chat time). */
function testRecommend() {
  Logger.log(JSON.stringify(recommend_('Sophie', ''), null, 2));
}

/**
 * DIAGNOSTIC: run from the editor and paste the log to Claude.
 * 1. Sends a tiny hello to each candidate model (5 seconds apart).
 * 2. Sends Sophie's real recommendation request to the first two that answered.
 * Ends with a suggested GEMINI_MODEL.
 */
var DIAGNOSE_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
  'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

function diagnoseGemini() {
  var send = function (model, body) {
    var start = Date.now();
    var res = UrlFetchApp.fetch(GEMINI_BASE + 'models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': geminiKey_() }, payload: JSON.stringify(body)
    });
    var text = res.getContentText();
    var msg = res.getResponseCode() === 200 ? 'OK' : ((JSON.parse(text).error || {}).message || text).slice(0, 160);
    return { code: res.getResponseCode(), secs: ((Date.now() - start) / 1000).toFixed(1), msg: msg, body: text };
  };

  Logger.log('STEP 1: tiny hello to each model');
  var working = [];
  DIAGNOSE_MODELS.forEach(function (m, i) {
    if (i) Utilities.sleep(5000);
    var r = send(m, { contents: [{ parts: [{ text: 'Say hello in five words.' }] }] });
    Logger.log(m + ' | ' + r.code + ' in ' + r.secs + 's | ' + r.msg);
    if (r.code === 200) working.push(m);
  });
  if (!working.length) {
    Logger.log('RESULT: no model answered. Google is very busy for free users right now; try again later, or ask Claude about a backup provider.');
    return;
  }

  Logger.log('STEP 2: full recommendation request');
  var books = listBooks_(userSheet_('Sophie'));
  var body = {
    systemInstruction: { parts: [{ text: librarianSystem_('Sophie') }] },
    contents: [{ role: 'user', parts: [{ text: librarianMessage_('Sophie', '', books, [], [], null) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: librarianSchema_(), temperature: 1 }
  };
  var best = null;
  working.slice(0, 2).forEach(function (m) {
    Utilities.sleep(5000);
    var r = send(m, body);
    var extra = '';
    if (r.code === 200) {
      var data = JSON.parse(r.body);
      var out = JSON.parse(((data.candidates[0].content.parts || []).filter(function (p) { return !p.thought; })[0] || {}).text || '{}');
      extra = ' | picks: ' + (out.recommendations || []).map(function (x) { return x.title + ' (' + x.type + ')'; }).join('; ');
      if (!best) best = m;
    }
    Logger.log(m + ' | ' + r.code + ' in ' + r.secs + 's | ' + r.msg + extra);
  });
  Logger.log(best
    ? 'RESULT: set Script Property GEMINI_MODEL to ' + best + ' (models that answered: ' + working.join(', ') + ')'
    : 'RESULT: these answered a hello but not the full request: ' + working.join(', ') + '. Paste this log to Claude.');
}
