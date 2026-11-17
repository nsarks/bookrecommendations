// Loads the real Apps Script code (Cleaning.gs + Api.gs) with pretend Google services,
// so it can be tested on a laptop. Used by api.test.js and mock-server.js.
const fs = require('fs');
const path = require('path');

function fakeSheet(name, rows) {
  const data = rows.map((r) => r.slice());
  return {
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => data[0].length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
      setValues: (vals) => vals.forEach((v, i) => {
        while (data.length < r + i) data.push(new Array(data[0].length).fill(''));
        v.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; });
      })
    }),
    deleteRow: (r) => data.splice(r - 1, 1),
    data
  };
}

function makeBackend(tabs, props) {
  const sheets = {};
  Object.keys(tabs).forEach((n) => { sheets[n] = fakeSheet(n, tabs[n]); });
  const cache = {};
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k], put: (k, v) => { cache[k] = v; }, remove: (k) => delete cache[k] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] }) },
    ContentService: {}, Logger: { log() {} }
  };
  const dir = path.join(__dirname, '../apps-script');
  const src = ['Cleaning.gs', 'Api.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const api = new Function(...Object.keys(env), 'module', src + '\nreturn { handle_: handle_ };')(...Object.values(env), undefined);
  return { handle: api.handle_, sheets };
}

const HEADERS = ['Title', 'Author', 'Rating', 'Commentary', 'Status', 'Added', 'Updated', 'Needs attention'];
module.exports = { makeBackend, HEADERS };
