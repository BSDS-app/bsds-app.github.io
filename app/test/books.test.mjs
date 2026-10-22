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

/* A stand-in bucket. In the preview the app reads books from ./books-demo/
   instead of Cloud Storage; these are the files it finds there. */
const TM = 'books/tm-ranger-dx800-t4-47047/';
const DEMO_BOOKS = {
  [TM + 'manifest.json']: JSON.stringify({ v: 1, kind: 'pdf', id: 'tm-ranger-dx800-t4-47047',
    title: 'Ranger DX800 T4 47047', lib: 'Ranger', folder: 'Ranger DX800 T4 47047', serial: '47047',
    parts: 3, sections: [
      { key: 'sp', title: 'Spare parts', files: [
        { p: 'sp/13.pdf', t: 'Chapter 13 — Tank Assembly', b: 5e6, ch: '13' },
        { p: 'sp/16.pdf', t: 'Chapter 16 — Towing eye', b: 1.6e7, ch: '16' }] },
      { key: 'ws', title: 'Workshop', files: [{ p: 'ws/hydraulics.pdf', t: 'hydraulics', b: 1e7 }] }] }),
  [TM + 'index.json']: JSON.stringify({ v: 1, rows: [
    ['00302748', 'Pin', '16', '05502008f', 'Towing eye', '1', '4', ''],
    ['00302749', 'Pin, long', '16', '05502008f', 'Towing eye', '2', '5', ''],
    ['03246358', 'Clip', '13', '55190585e', 'Tank Assembly', '1', '*49', '78']] }),
  [TM + 'files/sp/16.pdf']: '%PDF-1.4 stand-in',
  'books/epiroc-d65/manifest.json': JSON.stringify({ v: 1, kind: 'html', id: 'epiroc-d65',
    title: 'D65', lib: 'Epiroc', serial: '', file: 'book.html' }),
  'books/epiroc-d65/book.html': '<p id="inside">D65 book</p><script>'
    + 'document.title = (function(){try{return String(window.parent.document.cookie)}catch(e){return "SEALED"}})();'
    + '</script>',
};

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/books-demo/')) {
    const body = DEMO_BOOKS[u.slice('/books-demo/'.length)];
    if (body == null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': /\.pdf$/.test(u) ? 'application/pdf'
      : /\.html$/.test(u) ? 'text/html' : 'application/json' });
    res.end(body);
    return;
  }
  const p = path.join(ROOT, u);
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
  /* the build sandbox keeps its own Chromium; anywhere else, Playwright's */
  ...(fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } : {}),
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

/* ---- books in storage -------------------------------------------------
   books.stored.json is the real one the stage script wrote. */
const stored = JSON.parse(fs.readFileSync(path.join(ROOT, 'books.stored.json'), 'utf8')).books;
ok(stored.some(b => b.id === 'tm-ranger-dx800-t4-47047') && stored.some(b => b.id === 'epiroc-70165'),
  'the stored list names the Toolman and the Epiroc books', String(stored.length));
ok(data.machines.filter(m => m.state === 'matched')
  .every(m => stored.some(b => b.kind === 'pdf' && b.folder === m.book.folder)),
  'every machine matched by serial has its book in storage');
ok(!stored.some(b => /60673|75771/.test(b.folder)), 'and the near-miss books are not up there');

const ep = await page.evaluate(async () => {
  const b = await import('./books.js');
  await b.load();
  const v = id => { const x = b.forMachine(id, {}); return { how: x.how, store: x.book && x.book.store,
    stored: (b.storedFor(x.book) || {}).id || null }; };
  return {
    dm45: v('wesco-ut--70165'),
    dr607: v('3-rivers-drilling-blasting--DR607'),
    d65: v('fisher-industries--110390'),
    dr617: v('3-rivers-drilling-blasting--DR617'),
  };
});
ok(ep.dm45.how === 'serial' && ep.dm45.store === 'epiroc-70165',
  'DM45 70165 now matches its converted book — same serial, same rule', JSON.stringify(ep.dm45));
ok(ep.dr607.how === 'serial' && ep.dr607.store === 'epiroc-dr607',
  'DR607 (s/n 7165) matches the DR607 book', JSON.stringify(ep.dr607));
ok(ep.d65.how === 'none', 'a D65 with a TMG serial gets NO book: the D65 book carries no serial',
  JSON.stringify(ep.d65));
ok(ep.dr617.how === 'serial' && ep.dr617.stored === 'tm-ranger-dx800-t4-47047',
  'a Toolman match finds its stored copy', JSON.stringify(ep.dr617));
const heldStill = await page.evaluate(async (s) => {
  const b = await import('./books.js');
  await b.load();
  const m = b.loaded().machines.find(x => x.serial === s);
  return b.forMachine(m.id, {}).how;
}, '60674');
ok(heldStill === 'none', 'the held machine is still held', heldStill);

const hits = await page.evaluate(async () => {
  const s = await import('./bookstore.js');
  const idx = { rows: [['00302748', 'Pin', '16', 'a', 'Towing eye', '1', '4', ''],
                       ['00302749', 'Pin, long', '16', 'a', 'Towing eye', '1', '5', ''],
                       ['100302748', 'Other', '9', 'a', 'Elsewhere', '1', '1', '']] };
  return { exact: s.search(idx, '00302748').map(r => r[0]),
           words: s.search(idx, 'towing pin').map(r => r[0]),
           dashed: s.search(idx, '0030-2748').map(r => r[0]) };
});
ok(hits.exact[0] === '00302748', 'an exact part number comes first', JSON.stringify(hits.exact));
ok(hits.words.length === 2, 'words off the drawing find the parts', JSON.stringify(hits.words));
ok(hits.dashed[0] === '00302748', 'punctuation in a typed number does not matter', JSON.stringify(hits.dashed));

/* ---- the screens, as a tech --------------------------------------------- */
const tap = async (attrs) => {
  await page.evaluate((a) => {
    const btn = document.createElement('button');
    Object.entries(a).forEach(([k, v]) => btn.setAttribute(k, v));
    document.body.appendChild(btn);
    btn.click();
    btn.remove();
  }, attrs);
  await page.waitForTimeout(400);
};
await page.click('[data-demo="demo-clint"]');
await page.waitForTimeout(300);
await tap({ 'data-bookfor': '3-rivers-drilling-blasting--DR617' });
const openBtn = await page.$('[data-openbook="tm-ranger-dx800-t4-47047"]');
ok(!!openBtn, 'a matched machine’s page has an Open the book button');
if (openBtn) await openBtn.click();
await page.waitForTimeout(500);
const bookTxt = await page.textContent('#view');
ok(/Spare parts/.test(bookTxt) && /Chapter 16/.test(bookTxt) && /Workshop/.test(bookTxt),
  'the book opens on its contents, parts first', bookTxt.slice(0, 160));
ok(!/NOT THIS MACHINE/.test(bookTxt), 'a serial match carries no red banner');
await page.fill('#bpq', '00302748');
await page.waitForTimeout(500);
const hitTxt = await page.textContent('#bphits');
ok(/00302748/.test(hitTxt) && /Ch 16/.test(hitTxt), 'a part number goes straight to its chapter', hitTxt.slice(0, 120));
await page.click('#bphits [data-bfile="sp/16.pdf"]');
await page.waitForTimeout(600);
const openHref = await page.getAttribute('#bopen', 'href');
ok(/^blob:/.test(openHref || ''), 'the chapter is fetched and handed over as a file', openHref);
const leaks = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
  .filter(a => /firebasestorage|token=/.test(a.href)).length);
ok(leaks === 0, 'no shareable storage link is ever put on the page');

/* ---- a judgement pick keeps its banner all the way to the PDF --------- */
await page.click('#signout');
await page.waitForTimeout(300);
await page.click('[data-demo="demo-mike"]');
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const b = await import('./books.js');
  await b.load();
  await b.savePick('fisher-industries--110390',
    { folder: 'Ranger DX800 T4 47047', lib: 'Ranger', serial: '47047' }, 'test');
});
await tap({ 'data-bookfor': 'fisher-industries--110390' });
ok(!!(await page.$('[data-openbook="tm-ranger-dx800-t4-47047"][data-for="fisher-industries--110390"]')),
  'a judgement pick that is in storage opens from the machine too');
await tap({ 'data-openbook': 'tm-ranger-dx800-t4-47047', 'data-for': 'fisher-industries--110390' });
ok(!!(await page.$('.bookwarn')), 'THE POINT: opened from a judgement pick, the book carries the red banner');
await page.click('[data-bfile="sp/16.pdf"]');
await page.waitForTimeout(600);
ok(!!(await page.$('.bookwarn')), 'and so does the chapter it leads to');
await tap({ 'data-openbook': 'tm-ranger-dx800-t4-47047' });
ok(!(await page.$('.bookwarn')), 'opened from the library, not for a machine, it has none');

/* ---- a converted page is sealed off from the app ---------------------- */
await tap({ 'data-openbook': 'epiroc-d65' });
await page.waitForTimeout(400);
const sb = await page.getAttribute('.frame iframe', 'sandbox');
ok(sb !== null && !/allow-same-origin/.test(sb), 'the converted book runs in a sealed frame', String(sb));
const fr = page.frames().find(f => f !== page.mainFrame());
const sealed = fr ? await fr.evaluate(() => document.title) : '';
ok(sealed === 'SEALED', 'and its scripts cannot reach the app around it', sealed);

/* the library screen lists what is in the app instead of linking out */
await tap({ 'data-go': 'books' });
await page.waitForTimeout(400);
/* blue tiles are parts books; the teal shelf of schematics and manuals is
   not part of this move and still links out */
const libLinks = await page.$$eval('a.tile.blue[href*="claude.ai/artifact"]', a => a.map(x => x.href));
ok(libLinks.length === 0, 'a book that is in storage no longer sends anyone to claude.ai', libLinks.join(' '));
ok((await page.$$('[data-openbook]')).length === stored.length, 'every stored book is on the library screen');

const real = errs.filter(e => !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(e));
ok(real.length === 0, 'no script errors', real.slice(0, 2).join(' | '));

await ctx.close();
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
