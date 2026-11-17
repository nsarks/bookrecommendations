/**
 * ONE-OFF SETUP. Run setupLibrary() from the Apps Script editor.
 * It:
 *  1. Renames your original tab to "Sophie (original backup)" and never changes it.
 *  2. Builds a new, tidied "Sophie" tab from it (so running it again is safe).
 *  3. Creates a plain "Nick" tab (any books in an existing Nick tab are copied in).
 *  4. Writes a "Setup report" tab listing every change and anything to check.
 *  5. Creates a hidden "Meta" tab (last chat times). This is done last and
 *     marks setup as finished; after that the script refuses to run again.
 */
var BACKUP_NAME = 'Sophie (original backup)';

var step = 'starting';

function setupLibrary() {
  try {
    setupLibrary_();
  } catch (e) {
    throw new Error('Setup stopped while ' + step + ': ' + e.message);
  }
}

function setupLibrary_() {
  step = 'checking the Sheet';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('Meta')) {
    throw new Error('Setup has already finished (a "Meta" tab exists). Nothing was changed.');
  }

  step = 'making the backup';
  // 1. The original tab becomes the backup and is never written to.
  //    (It may be a Sheets "Table", which refuses many script edits.)
  var backup = ss.getSheetByName(BACKUP_NAME);
  if (!backup) {
    backup = (ss.getSheetByName('Sheet1') || ss.getSheets()[0]).setName(BACKUP_NAME);
  }
  // A "Sophie" tab left by an earlier failed run is set aside, not deleted.
  var old = ss.getSheetByName('Sophie');
  if (old) old.setName('Sophie (failed setup ' + new Date().getTime() + ', safe to delete)');
  var sophie = ss.insertSheet('Sophie', 0);

  step = 'building the Sophie tab';
  // 2. Clean from the backup and write to Sophie.
  var raw = backup.getDataRange().getValues().slice(1)
    .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  var result = cleanRows(raw);
  var now = new Date();
  var out = [HEADERS].concat(result.books.map(function (b) {
    return [b.title, b.author, b.rating, b.commentary, b.status, now, now, b.flags.join('; ')];
  }));
  sophie.getRange(1, 1, out.length, HEADERS.length).setValues(out);
  formatBookTab_(sophie);

  // 3. Nick's tab. An existing "Nick" tab (possibly a Table) is set aside and
  //    any books in it are tidied and copied into a fresh plain tab.
  step = 'building the Nick tab';
  var nickRows = [];
  var oldNick = ss.getSheetByName('Nick');
  if (oldNick) {
    nickRows = oldNick.getDataRange().getValues().slice(1)
      .filter(function (r) { return String(r[0]).trim() !== ''; });
    oldNick.setName('Nick (old ' + new Date().getTime() + ', safe to delete)');
  }
  var nick = ss.insertSheet('Nick', 1);
  var nickBooks = cleanRows(nickRows).books;
  var nickOut = [HEADERS].concat(nickBooks.map(function (b) {
    return [b.title, b.author, b.rating, b.commentary, b.status, now, now, b.flags.join('; ')];
  }));
  nick.getRange(1, 1, nickOut.length, HEADERS.length).setValues(nickOut);
  formatBookTab_(nick);

  step = 'writing the Setup report';
  // 4. Report.
  var oldReport = ss.getSheetByName('Setup report');
  if (oldReport) ss.deleteSheet(oldReport);   // only ever holds this script's own output
  var report = ss.insertSheet('Setup report');
  var rep = [['Row', 'Field', 'Before', 'After']].concat(result.changes);
  report.getRange(1, 1, rep.length, 4).setValues(rep);
  var flagged = [];
  result.books.forEach(function (b, i) {
    if (b.flags.length) flagged.push([i + 2, b.title, b.flags.join('; '), '']);
  });
  var start = rep.length + 2;
  report.getRange(start, 1, 1, 4).setValues([['Row', 'Title', 'Needs attention', '']]);
  if (flagged.length) report.getRange(start + 1, 1, flagged.length, 4).setValues(flagged);
  tryFormat_(function () {
    report.getRange(1, 1, 1, 4).setFontWeight('bold');
    report.getRange(start, 1, 1, 4).setFontWeight('bold');
  });

  step = 'creating the Meta tab';
  // 5. Meta (marks setup as finished).
  var meta = ss.insertSheet('Meta');
  meta.getRange(1, 1, 3, 2).setValues([['User', 'LastChat'], ['Sophie', now], ['Nick', now]]);
  meta.hideSheet();

  ss.setActiveSheet(sophie);
  ss.toast(result.books.length + ' books tidied, ' + result.changes.length + ' changes, ' +
    flagged.length + ' rows need attention. See the "Setup report" tab.', 'Setup complete', 15);
}

/** Cosmetic only. Each step is optional, so a Sheets "Table" can't stop setup. */
function formatBookTab_(sh) {
  tryFormat_(function () { sh.setFrozenRows(1); });
  tryFormat_(function () { sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold'); });
  tryFormat_(function () { sh.getRange('F2:F').setNumberFormat('yyyy-mm-dd hh:mm'); });
  tryFormat_(function () { sh.getRange('G2:G').setNumberFormat('yyyy-mm-dd hh:mm'); });
  tryFormat_(function () { sh.getRange('D2:D').setWrap(true); });
  tryFormat_(function () { sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 160); sh.setColumnWidth(4, 360); });
  tryFormat_(function () {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
    sh.getRange('E2:E').setDataValidation(rule);
  });
}

function tryFormat_(fn) {
  try { fn(); } catch (e) { Logger.log('Formatting skipped: ' + e.message); }
}
