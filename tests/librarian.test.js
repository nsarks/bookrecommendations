// Run with: node tests/librarian.test.js
// Tests the librarian's logic with a pretend Gemini.
const assert = require('assert');
const { makeBackend, HEADERS: H } = require('./fake-apps-script');

const lastChat = new Date('2026-11-01T10:00:00Z');
const old = new Date('2026-01-01T10:00:00Z');
const recent = new Date('2026-11-10T10:00:00Z');
const tabs = () => ({
  Sophie: [H,
    ['Rebecca', 'Daphne du Maurier', 10, 'Loved the atmosphere', 'Read', old, old, ''],
    ['Middlemarch', 'George Eliot', '', 'Too slow', 'Stopped Reading', old, old, ''],
    ['Piranesi', '', '', '', 'TBR', recent, recent, '']],
  Nick: [H],
  Meta: [['User', 'LastChat'], ['Sophie', lastChat], ['Nick', lastChat]]
});
const reply = (recs) => ({
  greeting: 'Lovely to hear from you, Sophie!',
  newBooksComment: 'Oh, I see you have added Piranesi to your TBR.',
  recommendations: recs,
  closing: 'I picked these because you loved Rebecca.',
  missingAuthors: [{ title: 'Piranesi', author: 'Susanna Clarke' }]
});
const rec = (title, type) => ({ title, author: 'Someone', type: type || 'Safe Bet', pitch: 'You will love it.' });
const props = { PASSCODE: 'p', GEMINI_API_KEY: 'k' };

// 1. Happy path: prompt contents, new books, author filling, last chat updated
let be = makeBackend(tabs(), props, () => reply([rec('My Cousin Rachel'), rec('The Thirteenth Tale'), rec('Klara and the Sun', 'Wildcard')]));
let r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie', steer: 'something gothic' });
assert.ok(r.ok, r.error);
assert.strictEqual(r.reply.recommendations.length, 3);
const body = be.calls[0].body;
const sys = body.systemInstruction.parts[0].text, msg = body.contents[0].parts[0].text;
assert.strictEqual(be.calls[0].model, 'gemini-flash-latest');
assert.strictEqual(r.model, 'gemini-flash-latest');
assert.match(sys, /Sophie's personal librarian/);
assert.match(sys, /British English/);
assert.match(msg, /Steer: something gothic/);
assert.match(msg, /NEW SINCE LAST CHAT: \n- Piranesi: added as TBR/);
assert.doesNotMatch(msg, /- Rebecca:/);                 // old book isn't "new"
assert.match(msg, /MISSING AUTHORS: Piranesi/);
assert.match(msg, /Rebecca \| Daphne du Maurier \| Read \| 10\/10 \| Loved the atmosphere/);
assert.strictEqual(be.sheets.Sophie.data[3][1], 'Susanna Clarke');
assert.match(be.sheets.Sophie.data[3][7], /filled in by the librarian/);
assert.ok(be.sheets.Meta.data[1][1] > lastChat);
assert.strictEqual(be.sheets.Meta.data[2][1], lastChat);   // Nick untouched

// 2. One request; owned books and repeats are skipped, keeping 2 Safe Bets + 1 Wildcard
be = makeBackend(tabs(), props, () => reply([rec('rebecca!'), rec('My Cousin Rachel'), rec('my cousin rachel'),
  rec('The Thirteenth Tale'), rec('Klara and the Sun', 'Wildcard'), rec('Never Let Me Go', 'Wildcard')]));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(be.calls.length, 1);
assert.match(be.calls[0].body.systemInstruction.parts[0].text, /5 candidates/);
assert.deepStrictEqual(r.reply.recommendations.map((x) => x.title), ['My Cousin Rachel', 'The Thirteenth Tale', 'Klara and the Sun']);

// 3. If too few are left, it shows what it has without asking again
be = makeBackend(tabs(), props, () => reply([rec('Rebecca'), rec('The Thirteenth Tale'), rec('Klara and the Sun', 'Wildcard')]));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(r.reply.recommendations.length, 2);
assert.strictEqual(be.calls.length, 1);

// 4. Empty library, unknown user and Gemini errors
be = makeBackend(tabs(), props, () => reply([]));
assert.strictEqual(be.handle({ passcode: 'p', action: 'recommend', user: 'Nick' }).code, 'empty');
assert.strictEqual(be.handle({ passcode: 'p', action: 'recommend', user: 'Bob' }).code, 'library');
assert.strictEqual(be.calls.length, 0);                  // never asks Gemini without a library
be = makeBackend(tabs(), props, () => 429);
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.ok(!r.ok && /busy/.test(r.error));
assert.strictEqual(be.sheets.Meta.data[1][1], lastChat);  // failed chat doesn't count
be = makeBackend(tabs(), { PASSCODE: 'p' }, () => reply([]));
assert.match(be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' }).error, /MISTRAL_API_KEY or GEMINI_API_KEY/);
assert.match(be.handle({ passcode: 'x', action: 'recommend', user: 'Sophie' }).error, /Wrong passcode/);

// 5. Busy model: move straight on to the next model. Never more than 3 calls.
be = makeBackend(tabs(), Object.assign({ GEMINI_MODEL: 'gemini-3.8-flash' }, props),
  (body, model) => (model === 'gemini-3.8-flash' ? 503 : reply([rec('My Cousin Rachel')])));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.ok(r.ok, r.error);
assert.deepStrictEqual(be.calls.map((c) => c.model), ['gemini-3.8-flash', 'gemini-3.7-flash']);
assert.strictEqual(r.model, 'gemini-3.7-flash');
be = makeBackend(tabs(), Object.assign({ GEMINI_MODEL: 'gemini-3.8-flash' }, props), (b, m) => (m === 'gemini-3.8-flash' ? 503 : 404));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.match(r.error, /very busy.*gemini-3.8-flash: 503, gemini-3.7-flash: 404, gemini-3.5-flash: 404/);
assert.strictEqual(be.calls.length, 3);
// Quota error on every model: then a one-minute cool-down
be = makeBackend(tabs(), props, () => 429);
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.match(r.error, /limit was reached/);
assert.strictEqual(be.calls.length, 3);
assert.match(be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' }).error, /short breather/);
assert.strictEqual(be.calls.length, 3);
be = makeBackend(tabs(), props, () => 400);
assert.match(be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' }).error, /could not be reached/);

// 6. Model can be changed in Script Properties
be = makeBackend(tabs(), Object.assign({ GEMINI_MODEL: 'gemini-3-flash' }, props), () => reply([rec('A')]));
be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(be.calls[0].model, 'gemini-3-flash');

// 7. Mistral first, Gemini as backup (Groq only if it has a key)
const mg = Object.assign({ MISTRAL_API_KEY: 'm' }, props);
be = makeBackend(tabs(), mg, () => reply([rec('From Gemini')]), null, () => reply([rec('From Mistral')]));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.deepStrictEqual(r.reply.recommendations.map((x) => x.title), ['From Mistral']);
assert.strictEqual(r.model, 'mistral/mistral-large-latest');
assert.strictEqual(be.calls.length, 1);
const mb = be.calls[0].body;
assert.strictEqual(mb.response_format.type, 'json_object');
assert.strictEqual(mb.reasoning_effort, undefined);
assert.match(mb.messages[0].content, /Sophie's personal librarian[\s\S]*ONLY a JSON object[\s\S]*"type":"Safe Bet \| Wildcard"/);
assert.match(mb.messages[1].content, /Rebecca \| Daphne du Maurier/);
// Mistral rate-limited -> Gemini
be = makeBackend(tabs(), mg, () => reply([rec('From Gemini')]), null, () => 429);
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(r.model, 'gemini-flash-latest');
assert.deepStrictEqual(be.calls.map((c) => c.provider), ['mistral', 'gemini']);
// Missing Mistral model -> next Mistral model
be = makeBackend(tabs(), mg, () => 500, null, (b, m) => (m === 'mistral-large-latest' ? 404 : reply([rec('From Medium')])));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(r.model, 'mistral/mistral-medium-latest');
// Everything busy, all three services configured: still at most 3 requests
be = makeBackend(tabs(), Object.assign({ GROQ_API_KEY: 'g' }, mg), () => 503, () => 503, () => 503);
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.match(r.error, /very busy.*mistral\/mistral-large-latest: 503, groq\/openai\/gpt-oss-120b: 503, gemini-flash-latest: 503/);
assert.strictEqual(be.calls.length, 3);
// Groq + Gemini keys only: Groq goes first by default, with gpt-oss reasoning turned down
be = makeBackend(tabs(), Object.assign({ GROQ_API_KEY: 'g' }, props), () => 500, () => reply([rec('From Groq')]));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(r.model, 'groq/openai/gpt-oss-120b');
assert.strictEqual(be.calls[0].body.reasoning_effort, 'low');
// Mistral key only
be = makeBackend(tabs(), { PASSCODE: 'p', MISTRAL_API_KEY: 'm' }, null, null, () => reply([rec('From Mistral')]));
assert.ok(be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' }).ok);

console.log('All librarian tests passed');
