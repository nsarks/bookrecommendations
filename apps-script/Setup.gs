/**
 * ONE-OFF SETUP. Run setupLibrary() once from the Apps Script editor.
 * It:
 *  1. Copies your original tab to "Sophie (original backup)" so nothing is lost.
 *  2. Renames that tab to "Sophie" and tidies every row.
 *  3. Creates an empty "Nick" tab with the same headers.
 *  4. Creates a hidden "Meta" tab that remembers when each of you last chatted.
 *  5. Writes a "Setup report" tab listing every change and anything to check.
 * It refuses to run twice.
 */
function setupLibrary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('Sophie')) {
    throw new Error('Setup has already run: a "Sophie" tab exists. Nothing was changed.');
  }
  var src = ss.getSheetByName('Sheet1') || ss.getSheets()[0];
  src.copyTo(ss).setName('Sophie (original backup)');
  src.setName('Sophie');

  var raw = src.getDataRange().getValues().slice(1)
    .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  var result = cleanRows(raw);
  var now = new Date();

  src.clearContents();
  var out = [HEADERS].concat(result.books.map(function (b) {
    return [b.title, b.author, b.rating, b.commentary, b.status, now, now, b.flags.join('; ')];
  }));
  src.getRange(1, 1, out.length, HEADERS.length).setValues(out);
  formatBookTab_(src);

  var nick = ss.insertSheet('Nick');
  nick.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  formatBookTab_(nick);

  var meta = ss.insertSheet('Meta');
  meta.getRange(1, 1, 3, 2).setValues([['User', 'LastChat'], ['Sophie', now], ['Nick', now]]);
  meta.hideSheet();

  var report = ss.insertSheet('Setup report');
  var flagged = [];
  result.books.forEach(function (b, i) {
    if (b.flags.length) flagged.push([i + 2, b.title, b.flags.join('; '), '']);
  });
  var rep = [['Row', 'Field', 'Before', 'After']].concat(result.changes);
  report.getRange(1, 1, rep.length, 4).setValues(rep);
  var start = rep.length + 2;
  report.getRange(start, 1, 1, 4).setValues([['Row', 'Title', 'Needs attention', '']]);
  if (flagged.length) report.getRange(start + 1, 1, flagged.length, 4).setValues(flagged);
  report.getRange(1, 1, 1, 4).setFontWeight('bold');
  report.getRange(start, 1, 1, 4).setFontWeight('bold');

  ss.setActiveSheet(src);
  ss.toast(result.books.length + ' books tidied, ' + result.changes.length + ' changes, ' +
    flagged.length + ' rows need attention. See the "Setup report" tab.', 'Setup complete', 15);
}

function formatBookTab_(sh) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sh.getRange('F:G').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange('D:D').setWrap(true);
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(4, 360);
  // Status column only accepts the three allowed values.
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
  sh.getRange(2, 5, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}
