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
assert.strictEqual(be.calls[0].model, 'gemini-2.5-flash');
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

// 2. Recommending something already owned triggers a retry with an exclusion list
let n = 0;
be = makeBackend(tabs(), props, () => (++n === 1
  ? reply([rec('rebecca!'), rec('The Thirteenth Tale'), rec('Klara and the Sun', 'Wildcard')])
  : reply([rec('My Cousin Rachel'), rec('The Thirteenth Tale'), rec('Klara and the Sun', 'Wildcard')])));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(be.calls.length, 2);
assert.match(be.calls[1].body.contents[0].parts[0].text, /ALREADY IN THE LIBRARY.*rebecca!/);
assert.deepStrictEqual(r.reply.recommendations.map((x) => x.title), ['My Cousin Rachel', 'The Thirteenth Tale', 'Klara and the Sun']);

// 3. If it keeps suggesting owned books, they are filtered out anyway
be = makeBackend(tabs(), props, () => reply([rec('Rebecca'), rec('The Thirteenth Tale'), rec('Klara and the Sun', 'Wildcard')]));
r = be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(r.reply.recommendations.length, 2);

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
assert.match(be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' }).error, /GEMINI_API_KEY/);
assert.match(be.handle({ passcode: 'x', action: 'recommend', user: 'Sophie' }).error, /Wrong passcode/);

// 5. Model can be changed in Script Properties
be = makeBackend(tabs(), Object.assign({ GEMINI_MODEL: 'gemini-3-flash' }, props), () => reply([rec('A')]));
be.handle({ passcode: 'p', action: 'recommend', user: 'Sophie' });
assert.strictEqual(be.calls[0].model, 'gemini-3-flash');

console.log('All librarian tests passed');
