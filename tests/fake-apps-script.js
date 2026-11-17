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
    getDataRange: () => ({ getValues: () => data.map((row) => row.slice()) }),
    appendRow: (row) => data.push(row.slice()),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValue: () => (data[r - 1] || [])[c - 1],
      setValue: (v) => { data[r - 1][c - 1] = v; },
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

// gemini(requestBody, model) should return the object the librarian would reply with.
function makeBackend(tabs, props, gemini) {
  const sheets = {};
  Object.keys(tabs).forEach((n) => { sheets[n] = fakeSheet(n, tabs[n]); });
  const cache = {};
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k], put: (k, v) => { cache[k] = v; }, remove: (k) => delete cache[k] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] }) },
    ContentService: {}, Logger: { log() {} },
    Utilities: { formatDate: (d) => d.toDateString(), sleep() {} },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const model = (url.match(/models\/([^:]+):/) || [])[1];
        const body = JSON.parse(opts.payload);
        calls.push({ model, body });
        if (!gemini) return { getResponseCode: () => 500, getContentText: () => '' };
        const reply = gemini(body, model);
        if (typeof reply === 'number') return { getResponseCode: () => reply, getContentText: () => '' };
        const text = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
        return { getResponseCode: () => 200, getContentText: () => text };
      }
    }
  };
  const calls = [];
  const dir = path.join(__dirname, '../apps-script');
  const src = ['Cleaning.gs', 'Api.gs', 'Librarian.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const api = new Function(...Object.keys(env), 'module', src + '\nreturn { handle_: handle_ };')(...Object.values(env), undefined);
  return { handle: api.handle_, sheets, calls };
}

const HEADERS = ['Title', 'Author', 'Rating', 'Commentary', 'Status', 'Added', 'Updated', 'Needs attention'];
module.exports = { makeBackend, HEADERS };
