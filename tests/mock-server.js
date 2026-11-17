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
  Nick: [HEADERS],
  Meta: [['User', 'LastChat'], ['Sophie', d('2026-11-01')], ['Nick', d('2026-11-01')]]
}, { PASSCODE: 'test', GEMINI_API_KEY: 'fake' }, (body) => {
  // A pretend librarian. Set GEMINI=429 to simulate the free-tier limit.
  if (process.env.GEMINI) return Number(process.env.GEMINI);
  const name = /Reader: (\w+)/.exec(body.contents[0].parts[0].text)[1];
  return {
    greeting: `Lovely to hear from you, ${name}! Hope you've been having a good reading week.`,
    newBooksComment: 'Oh, I see you\'ve added Piranesi to your TBR. That\'s a cracking choice, I think you\'ll find the prose quite striking.',
    recommendations: [
      { title: 'My Cousin Rachel', author: 'Daphne du Maurier', type: 'Safe Bet', pitch: 'Since Rebecca was a ten for you, this is the natural next step: the same creeping unease and a narrator you can never quite trust.' },
      { title: 'The Starless Sea', author: 'Erin Morgenstern', type: 'Safe Bet', pitch: 'More of that dreamy, lantern-lit atmosphere you loved in The Night Circus, with stories folded inside stories.' },
      { title: 'Never Let Me Go', author: 'Kazuo Ishiguro', type: 'Wildcard', pitch: 'Quieter and more literary than your usual picks, but its slow-dawning secret will hook you just as surely as a twisty mystery.' }
    ],
    closing: "I've picked these because I know you loved the atmosphere in Rebecca and The Night Circus, and I've steered clear of anything slow and sprawling since I saw you didn't get on with Middlemarch.",
    missingAuthors: []
  };
});

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
      const delay = Number(process.env.DELAY || (body.includes('"recommend"') ? 2500 : 300));   // feel a little like the real thing
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
