// Run with: node tests/cleaning.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
// .gs files are plain JavaScript; load the file directly.
const m = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '../apps-script/Cleaning.gs'), 'utf8'))(m);
const c = m.exports;

assert.strictEqual(c.tidyTitle('The Secret History '), 'The Secret History');
assert.strictEqual(c.tidyTitle('Catching FIre'), 'Catching Fire');
assert.strictEqual(c.tidyTitle('To kill a Mockingbird'), 'To Kill a Mockingbird');
assert.strictEqual(c.tidyTitle('the sublte knife'), 'The Subtle Knife');
assert.strictEqual(c.tidyTitle('Everything i know about love'), 'Everything I Know About Love');
assert.strictEqual(c.tidyTitle("I like Richard's"), "I Like Richard's");
assert.strictEqual(c.tidyAuthor('J.K Rowling'), 'J.K. Rowling');
assert.strictEqual(c.tidyAuthor('V.E.Schwab'), 'V.E. Schwab');
assert.strictEqual(c.tidyAuthor('F.Scott Fitzgerald'), 'F. Scott Fitzgerald');
assert.strictEqual(c.tidyAuthor('D.H.Lawrence'), 'D.H. Lawrence');
assert.strictEqual(c.tidyAuthor('Larsson'), 'Stieg Larsson');
assert.strictEqual(c.normKey('  The Handmaid’s Tale!'), c.normKey('the handmaids tale'));
assert.strictEqual(c.tidyStatus('to be read'), 'TBR');
assert.strictEqual(c.tidyStatus('DNF'), 'Stopped Reading');

const r = c.cleanRows([
  ['Us', 'David Nicholls', 7, '', 'Read'],
  ['Atmosphere ', 'Taylor Jenkins Reid', '', '', 'Read'],
  ['us', 'David Nicholls', 11, '', 'Read'],
  ['New Book', 'Someone', '', '', 'TBR']
]);
assert.deepStrictEqual(r.books[0].flags, []);
assert.deepStrictEqual(r.books[1].flags, ['Missing rating']);
assert.deepStrictEqual(r.books[2].flags, ['Rating should be 1 to 10', 'Possible duplicate of row 2']);
assert.deepStrictEqual(r.books[3].flags, []);
console.log('All cleaning tests passed');
