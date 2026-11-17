// Run with: node tests/api.test.js
// Tests the backend logic against a pretend in-memory spreadsheet.
const assert = require('assert');
const { makeBackend, HEADERS: H } = require('./fake-apps-script');

const be = makeBackend({
  Sophie: [H, ['The Secret History', 'Donna Tartt', 7, 'Long', 'Read', '', '', ''],
    ['Atmosphere', 'Taylor Jenkins Reid', '', '', 'Read', '', '', 'Missing rating']],
  Nick: [H]
}, { PASSCODE: 'secret' });
const sheets = be.sheets;
const api = { handle_: be.handle };
const call = (o) => api.handle_(Object.assign({ passcode: 'secret' }, o));

// Passcode
assert.strictEqual(api.handle_({ passcode: 'x', action: 'list', user: 'Nick' }).error, 'Wrong passcode.');
assert.strictEqual(call({ action: 'list', user: 'Bob' }).error, 'Unknown user.');

// List
let r = call({ action: 'list', user: 'Sophie' });
assert.strictEqual(r.books.length, 2);
assert.strictEqual(r.books[1].rating, null);

// Add, then same title in different form updates instead of duplicating
r = call({ action: 'upsert', user: 'Nick', book: { title: 'Dune ', author: 'Frank Herbert', status: 'TBR' } });
assert.ok(r.ok && r.created);
r = call({ action: 'upsert', user: 'Nick', book: { title: 'dune!', rating: 9, commentary: 'Epic', status: 'Read' } });
assert.ok(r.ok && !r.created);
assert.strictEqual(sheets.Nick.data.length, 2);
assert.strictEqual(sheets.Nick.data[1][0], 'Dune');
assert.strictEqual(sheets.Nick.data[1][2], 9);

// Validation
assert.match(call({ action: 'upsert', user: 'Nick', book: { title: 'X', author: 'Y', status: 'Read' } }).error, /score is needed/);
assert.match(call({ action: 'upsert', user: 'Nick', book: { title: 'X', author: 'Y', rating: 11, status: 'Read' } }).error, /1 to 10/);
assert.match(call({ action: 'upsert', user: 'Nick', book: { title: 'X', status: 'TBR' } }).error, /author is needed/);

// Filling in a missing rating clears "Needs attention"
r = call({ action: 'upsert', user: 'Sophie', book: { title: 'atmosphere', rating: 8, status: 'Read' } });
assert.strictEqual(r.book.attention, '');

// Edit with rename; renaming onto an existing title is refused
r = call({ action: 'upsert', user: 'Sophie', originalTitle: 'Atmosphere', book: { title: 'Atmosphere: A Love Story', author: 'Taylor Jenkins Reid', rating: 8, status: 'Read' } });
assert.strictEqual(r.book.title, 'Atmosphere: A Love Story');
assert.match(call({ action: 'upsert', user: 'Sophie', originalTitle: 'Atmosphere: A Love Story', book: { title: 'the secret history', rating: 8, status: 'Read' } }).error, /already in your library/);

// Delete
assert.ok(call({ action: 'delete', user: 'Nick', title: 'DUNE' }).deleted);
assert.strictEqual(sheets.Nick.data.length, 1);
assert.match(call({ action: 'delete', user: 'Nick', title: 'Dune' }).error, /Could not find/);

console.log('All API tests passed');
