/**
 * Pure tidying functions for book rows. No Google services are used here,
 * so the same file can be tested on a laptop with Node.
 */

var HEADERS = ['Title', 'Author', 'Rating', 'Commentary', 'Status', 'Added', 'Updated', 'Needs attention'];
var STATUSES = ['Read', 'TBR', 'Stopped Reading'];

// Small words stay lower case in the middle of a title.
var SMALL_WORDS = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'or', 'the', 'to', 'with'];

// Known misspellings, keyed by the "matching key" of the wrong version.
// Edit this list freely: [as typed, corrected].
var TITLE_FIXES = [
  ['the sublte knife', 'The Subtle Knife'],
  ['Lessons on chemistry', 'Lessons in Chemistry'],
  ['Lady Chatterlys lover', "Lady Chatterley's Lover"],
  ['The Cuckoos Calling', "The Cuckoo's Calling"],
  ['The handmaids tale', "The Handmaid's Tale"],
  ['Harry Potter and the philosophers stone', "Harry Potter and the Philosopher's Stone"],
  ['Harry Potter and the half blood prince', 'Harry Potter and the Half-Blood Prince'],
  ['The invisible life of Addie Larue', 'The Invisible Life of Addie LaRue'],
  ['tomorrow and tomorrow and tomorrow', 'Tomorrow, and Tomorrow, and Tomorrow']
];
var AUTHOR_FIXES = [
  ['Larsson', 'Stieg Larsson'],
  ['Claire Daverly', 'Claire Daverley'],
  ['Emily Bronte', 'Emily Brontë']
];

/** Matching key: ignores case, spacing, punctuation and accents. */
function normKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function fixMap_(pairs) {
  var m = {};
  pairs.forEach(function (p) { m[normKey(p[0])] = p[1]; });
  return m;
}
var TITLE_FIX_MAP = fixMap_(TITLE_FIXES);
var AUTHOR_FIX_MAP = fixMap_(AUTHOR_FIXES);

function tidySpaces(s) {
  return String(s == null ? '' : s).replace(/[ \t ]+/g, ' ').trim();
}

function titleCase(s) {
  var words = tidySpaces(s).split(' ');
  return words.map(function (w, i) {
    if (!w) return w;
    if (/\d/.test(w)) return w;                       // e.g. "1984"
    if (/^[IVX]{2,}$/.test(w)) return w;              // Roman numerals
    if (/^[A-Z][a-z]+[A-Z][a-z]+/.test(w)) return w;  // LaRue, McCall
    var lower = w.toLowerCase();
    if (i > 0 && i < words.length - 1 && SMALL_WORDS.indexOf(lower) !== -1) return lower;
    // Capitalise the first letter, and any letter after a hyphen, full stop, bracket or quote.
    return lower.replace(/(^|[-.(“"])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); });
  }).join(' ');
}

function tidyTitle(s) {
  var t = tidySpaces(s);
  return TITLE_FIX_MAP[normKey(t)] || titleCase(t);
}

function tidyAuthor(s) {
  var a = tidySpaces(s);
  if (AUTHOR_FIX_MAP[normKey(a)]) return AUTHOR_FIX_MAP[normKey(a)];
  a = titleCase(a);
  a = a.replace(/\b([A-Z])(?=\s|$)/g, '$1.');   // "J.K Rowling" -> "J.K. Rowling"
  a = a.replace(/\.(?=[A-Za-z]{2,})/g, '. ');   // "V.E.Schwab" -> "V.E. Schwab"
  return tidySpaces(a);
}

function tidyStatus(s) {
  var k = normKey(s);
  if (k === 'read' || k === '') return 'Read';
  if (k === 'tbr' || k === 'toberead') return 'TBR';
  if (k === 'stopped' || k === 'stoppedreading' || k === 'dnf' || k === 'didnotfinish') return 'Stopped Reading';
  return null;
}

/** Returns {value, ok}. Empty ratings are allowed (value ''). */
function tidyRating(v) {
  var s = tidySpaces(v);
  if (s === '') return { value: '', ok: true };
  var n = Number(s);
  if (isNaN(n) || n < 1 || n > 10) return { value: s, ok: false };
  return { value: n, ok: true };
}

/**
 * Cleans raw rows of [Title, Author, Rating, Commentary, Status].
 * Returns { books: [{title, author, rating, commentary, status, flags}], changes: [[row, field, before, after]] }
 * Row numbers match the spreadsheet (header is row 1).
 */
function cleanRows(rows) {
  var books = [], changes = [], seen = {};
  rows.forEach(function (r, i) {
    var rowNum = i + 2, flags = [];
    var rawStatus = tidySpaces(r[4]);
    var status = tidyStatus(rawStatus);
    if (!status) { flags.push('Unknown status "' + rawStatus + '"'); status = 'Read'; }
    if (!rawStatus) flags.push('Status was blank, set to Read');
    var rating = tidyRating(r[2]);
    if (!rating.ok) flags.push('Rating should be 1 to 10');
    if (status === 'Read' && rating.value === '') flags.push('Missing rating');
    var b = {
      title: tidyTitle(r[0]),
      author: tidyAuthor(r[1]),
      rating: rating.value,
      commentary: String(r[3] == null ? '' : r[3]).replace(/[ \t ]+/g, ' ').trim(),
      status: status,
      flags: flags
    };
    if (!b.author) flags.push('Missing author');
    var key = normKey(b.title);
    if (seen[key]) flags.push('Possible duplicate of row ' + seen[key]);
    else seen[key] = rowNum;
    [['Title', r[0], b.title], ['Author', r[1], b.author], ['Rating', r[2], b.rating], ['Status', r[4], b.status]]
      .forEach(function (c) {
        if (String(c[1] == null ? '' : c[1]) !== String(c[2])) changes.push([rowNum, c[0], c[1], c[2]]);
      });
    books.push(b);
  });
  return { books: books, changes: changes };
}

if (typeof module !== 'undefined') {
  module.exports = { normKey: normKey, titleCase: titleCase, tidyTitle: tidyTitle, tidyAuthor: tidyAuthor,
    tidyStatus: tidyStatus, tidyRating: tidyRating, cleanRows: cleanRows, HEADERS: HEADERS };
}
