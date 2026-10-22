/* Parts books: a book belongs to a serial.
 *
 * Mike's rule is that a book-to-machine mismatch is unacceptable, and the
 * fleet contains the exact trap that rule exists for: machine 60674 with
 * 60673 in the library, and 75772 with 75771. One digit. A matcher trying
 * to be helpful pairs those and hands a tech the wrong book for a rig that
 * is already down.
 *
 * So the headline tests here are refusals, not matches.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (/icon-\d+\.png$/.test(file)) {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA'
      + 'C0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    return;
  }
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (path.basename(file) === 'config.js') {
    body = Buffer.from(String(body).replace(/(\n\s*apiKey: )'[^']*'/, "$1''"));
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

/* ---- the data file, checked before any browser is involved ---------- */
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'books.data.json'), 'utf8'));
const byId = {};
data.machines.forEach(m => { byId[m.id] = m; });
const bySerial = {};
data.machines.forEach(m => { if (m.serial) bySerial[m.serial] = m; });

ok(data.library.length > 600, 'the library index is there', String(data.library.length));
ok(data.machines.length === 77, 'every fleet machine has a row', String(data.machines.length));

/* THE TRAP. 60674 and 75772 are one digit from a real book. */
['60674', '75772'].forEach(s => {
  const m = bySerial[s];
  ok(!!m, `machine ${s} is in the registry`);
  if (!m) return;
  ok(m.state === 'hold', `${s} is HELD, not matched to its near-miss`, m.state);
  ok(!m.book, `${s} carries no book`);
});
/* and the near-misses really are in the library, so the trap is real */
ok(data.library.some(r => r.serial === '60673'), '60673 really is in the library');
ok(data.library.some(r => r.serial === '75771'), 'and so is 75771');

/* Mike's decisions, 21 Oct 2026 */
const dr618 = bySerial['43355'];
ok(dr618 && dr618.state === 'matched' && /DX600/.test(dr618.book.folder),
  'DR618 goes by the serial, so it gets the DX600 book',
  dr618 && dr618.book && dr618.book.folder);
const p56407 = bySerial['56407'];
ok(p56407 && /S5/.test(p56407.book.folder) && !/T4/.test(p56407.book.folder),
  '56407 gets the S5 book, not the T4', p56407 && p56407.book && p56407.book.folder);
ok(p56407 && p56407.decidedBy, 'and the record says a person decided that',
  p56407 && p56407.decidedBy);
const f110245 = byId[Object.keys(byId).find(k => byId[k].unit === '110245')];
ok(f110245 && /Pantera/i.test(f110245.book.folder),
  'Fisher 110245 builds to the Pantera 1500', f110245 && f110245.book && f110245.book.folder);

/* every matched book's serial equals its machine's serial. no exceptions */
let mismatch = 0;
data.machines.filter(m => m.state === 'matched').forEach(m => {
  const a = String(m.serial).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const b = String(m.book.serial).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a !== b) { mismatch++; bad.push('MISMATCH ' + m.unit + ' ' + m.serial + ' -> ' + m.book.folder); }
});
ok(mismatch === 0, 'THE RULE: every matched book carries its machine’s own serial',
  String(mismatch) + ' mismatches');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE);
await page.waitForTimeout(400);

const api = await page.evaluate(async () => {
  const b = await import('./books.js');
  await b.load();
  const find = q => b.find(q, 5).map(r => r.folder);
  return {
    serialHit: find('58348'),
    words: find('pantera 1500'),
    model: find('DI550'),
    libCount: b.library().length,
  };
});
ok(api.serialHit[0] === 'Leopard DI550 T4 58348',
  'searching a serial puts its book first', JSON.stringify(api.serialHit[0]));
ok(api.words.some(f => /Pantera/i.test(f) && /1500/.test(f)),
  'plain words find a family', JSON.stringify(api.words.slice(0, 2)));
ok(api.model.some(f => /DI550/.test(f)), 'and so does a model');

/* the warning has to name BOTH serials - that is the thing somebody sees */
const warn = await page.evaluate(async () => {
  const b = await import('./books.js');
  await b.load();
  return b.warning({
    how: 'judgement',
    machine: { serial: '60674', unit: '110374' },
    book: { serial: '60673', folder: 'Leopard DI550 S5 60673' },
    pick: { by: 'Mike Clunas', at: '2026-10-21T00:00:00Z', note: 'same vintage' },
  });
});
ok(/NOT/.test(warn) && /60673/.test(warn) && /60674/.test(warn),
  'THE POINT: the judgement warning names the book’s serial AND the machine’s',
  warn.slice(0, 120));
ok(/Mike Clunas/.test(warn), 'and who chose it');
ok(/check every part number/i.test(warn), 'and what to do about it');

const none = await page.evaluate(async () => {
  const b = await import('./books.js');
  await b.load();
  return b.warning({ how: 'serial', machine: { serial: '58348' },
                     book: { serial: '58348', folder: 'Leopard DI550 T4 58348' } });
});
ok(none === '', 'a serial match carries no warning — it is the real book', none);

const real = errs.filter(e => !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(e));
ok(real.length === 0, 'no script errors', real.slice(0, 2).join(' | '));

await ctx.close();
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
