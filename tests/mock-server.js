// Local test server: serves the app and a pretend backend with sample books.
//   node tests/mock-server.js     then open http://localhost:8080
//   Backend address: http://localhost:8080/exec   Passcode: test
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeBackend, HEADERS } = require('./fake-apps-script');

const d = (s) => new Date(s);
const be = makeBackend({
  Sophie: [HEADERS,
    ['The Night Circus', 'Erin Morgenstern', 9, 'Gorgeous, dreamy atmosphere.', 'Read', d('2026-01-02'), d('2026-01-02'), ''],
    ['Rebecca', 'Daphne du Maurier', 10, 'The tension! Manderley is a character in itself.', 'Read', d('2026-01-02'), d('2026-01-02'), ''],
    ['Circe', 'Madeline Miller', 8, '', 'Read', d('2026-01-02'), d('2026-01-02'), ''],
    ['Middlemarch', 'George Eliot', '', 'Too slow for me at the moment.', 'Stopped Reading', d('2026-01-02'), d('2026-01-02'), ''],
    ['The Remains of the Day', 'Kazuo Ishiguro', '', '', 'Read', d('2026-01-02'), d('2026-01-02'), 'Missing rating'],
    ['Piranesi', 'Susanna Clarke', '', '', 'TBR', d('2026-11-10'), d('2026-11-10'), '']
  ],
  Nick: [HEADERS]
}, { PASSCODE: 'test' });

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const root = path.join(__dirname, '..');

http.createServer((req, res) => {
  if (req.url === '/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try { out = be.handle(JSON.parse(body)); } catch (e) { out = { ok: false, error: e.message }; }
      const delay = Number(process.env.DELAY || 300);   // feel a little like the real thing
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(out));
      }, delay);
    });
    return;
  }
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(Number(process.env.PORT || 8080), () => console.log('Mock server on http://localhost:' + (process.env.PORT || 8080)));
