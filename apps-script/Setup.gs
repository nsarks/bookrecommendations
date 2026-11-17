/**
 * ONE-OFF SETUP. Run setupLibrary() from the Apps Script editor.
 * It:
 *  1. Copies your original tab to "Sophie (original backup)" so nothing is lost.
 *  2. Renames the original tab to "Sophie" and tidies every row (always working
 *     from the untouched backup, so running it again is safe).
 *  3. Creates an empty "Nick" tab with the same headers.
 *  4. Writes a "Setup report" tab listing every change and anything to check.
 *  5. Creates a hidden "Meta" tab (last chat times). This is done last and
 *     marks setup as finished; after that the script refuses to run again.
 */
var BACKUP_NAME = 'Sophie (original backup)';

function setupLibrary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('Meta')) {
    throw new Error('Setup has already finished (a "Meta" tab exists). Nothing was changed.');
  }

  // 1. Backup and rename (skipped if a previous run already did it).
  var backup = ss.getSheetByName(BACKUP_NAME);
  var sophie = ss.getSheetByName('Sophie');
  if (!backup) {
    var original = ss.getSheetByName('Sheet1') || ss.getSheets()[0];
    backup = original.copyTo(ss).setName(BACKUP_NAME);
    original.setName('Sophie');
    sophie = original;
  }
  if (!sophie) sophie = ss.insertSheet('Sophie');

  // 2. Clean from the backup and write to Sophie.
  var raw = backup.getDataRange().getValues().slice(1)
    .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  var result = cleanRows(raw);
  var now = new Date();
  var out = [HEADERS].concat(result.books.map(function (b) {
    return [b.title, b.author, b.rating, b.commentary, b.status, now, now, b.flags.join('; ')];
  }));
  sophie.clearContents();
  sophie.getRange(1, 1, out.length, HEADERS.length).setValues(out);
  formatBookTab_(sophie);

  // 3. Nick's tab.
  var nick = ss.getSheetByName('Nick') || ss.insertSheet('Nick');
  nick.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  formatBookTab_(nick);

  // 4. Report.
  var report = ss.getSheetByName('Setup report') || ss.insertSheet('Setup report');
  report.clearContents();
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
