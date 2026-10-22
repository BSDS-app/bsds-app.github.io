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

/* A real (tiny) PDF, one line of text per page, laid out the way a Toolman
   chapter is: contents first, then a drawing, then its parts list. */
function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  const font = 3 + pages.length * 2;
  pages.forEach(txt => {
    const c = `BT /F1 18 Tf 72 700 Td (${txt}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + at.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return out;
}
const DEMO_BOOKS = {
  [TM + 'manifest.json']: JSON.stringify({ v: 1, kind: 'pdf', id: 'tm-ranger-dx800-t4-47047',
    title: 'Ranger DX800 T4 47047', lib: 'Ranger', folder: 'Ranger DX800 T4 47047', serial: '47047',
    parts: 3, sections: [
      { key: 'sp', title: 'Spare parts', files: [
        { p: 'sp/13.pdf', t: 'Chapter 13 — Tank Assembly', b: 5e6, ch: '13' },
        { p: 'sp/16.pdf', t: 'Chapter 16 — Towing eye', b: 1.6e7, ch: '16' }] },
      { key: 'ws', title: 'Workshop', show: 'fold', files: [{ p: 'ws/hydraulics.pdf', t: 'hydraulics', b: 1e7 }] },
      { key: 'cat', title: 'Engine (Cat)', show: 'fold', files: [
        { p: 'cat/PM engine.pdf', t: 'PM engine', b: 2e7, o: 'tm-leopard-di650-82517/files/cat/PM engine.pdf' }] },
      { key: 'info', title: 'Other papers — warranty, safety notices, CD help', show: 'papers',
        files: [{ p: 'info/warranty.pdf', t: 'warranty', b: 2e6 }] }] }),
  /* the shared engine manual lives in ANOTHER book's folder */
  'books/tm-leopard-di650-82517/files/cat/PM engine.pdf': makePdf(['CAT ENGINE MANUAL', 'page two']),
  [TM + 'index.json']: JSON.stringify({ v: 1, rows: [
    ['00302748', 'Pin', '16', '05502008f', 'Towing eye', '1', '4', ''],
    ['00302749', 'Pin, long', '16', '05502008f', 'Towing eye', '2', '5', ''],
    ['03246358', 'Clip', '13', '55190585e', 'Tank Assembly', '1', '*49', '78'],
    ['05502008f', 'Plate', '16', '05502008f', 'Towing eye', '1', '2', '']] }),
  [TM + 'files/sp/16.pdf']: makePdf(['TABLE OF CONTENTS 16 TOWING EYE', 'TOWING EYE drawing 055 020 08 Plate',
                                     'TOWING EYE parts 00302748 Pin 1']),
  'books/epiroc-d65/manifest.json': JSON.stringify({ v: 1, kind: 'html', id: 'epiroc-d65',
    title: 'D65', lib: 'Epiroc', serial: '', file: 'book.html' }),
  'books/shelf-which-manual/manifest.json': JSON.stringify({ v: 1, kind: 'html', id: 'shelf-which-manual',
    title: 'Which Manual Does This Drill Take', lib: 'Reference', serial: '', shelf: true, file: 'book.html' }),
  'books/shelf-which-manual/book.html': '<p id="inside">Which manual</p>',
  /* shaped like the converted books: a tray, the book's own orderRows() and
     COLS, and nothing that knows about the app */
  'books/epiroc-d65/book.html': '<html><head><title>x</title></head><body><p id="inside">D65 book</p><script>'
    + 'document.title = (function(){try{return String(window.parent.document.cookie)}catch(e){return "SEALED"}})();'
    + 'let tray=[{i:0,q:"2"}];'
    + 'const COLS=["Part number","Qty","Ref","Description","Size / designation","Unit"];'
    + 'function orderRows(){return tray.map(t=>["5112 3345 00",t.q,"4","HOSE","","D-43"]);}'
    + '</script></body></html>',
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
/* the page viewer loads pdf.js from jsDelivr; serve the same pinned files
   from node_modules so this runs without a network */
const PDFJS_DIR = path.join(ROOT, 'node_modules', 'pdfjs-dist');
await ctx.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/**', route => {
  const rel = new URL(route.request().url()).pathname.replace(/^\/npm\/pdfjs-dist@3\.11\.174\//, '');
  const f = path.join(PDFJS_DIR, ...rel.split('/'));
  if (!f.startsWith(PDFJS_DIR) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, body: fs.readFileSync(f),
    contentType: /\.js$/.test(f) ? 'text/javascript' : 'application/octet-stream' });
});
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

/* ---- what a phone keeps: capped by size, oldest-opened goes first ------- */
const kept = await page.evaluate(async () => {
  const s = await import('./bookstore.js');
  await s.clearKept();
  const c = await caches.open('bsds-books');
  const lim = { cap: 1000, maxOne: 600 };
  const blob = n => new Blob([new Uint8Array(n)]);
  const has = async k => !!(await c.match(k));
  const u = n => 'https://books.bsds.local/books/x/' + n + '?g=1';
  await s.cachePut(c, u('a'), blob(400), '', lim);
  await new Promise(r => setTimeout(r, 5));
  await s.cachePut(c, u('b'), blob(400), '', lim);
  await new Promise(r => setTimeout(r, 5));
  await s.cacheGet(c, u('a'));                       /* a opened again: now b is the oldest */
  await new Promise(r => setTimeout(r, 5));
  await s.cachePut(c, u('c'), blob(400), '', lim);   /* over 1000: something must go */
  const afterCap = { a: await has(u('a')), b: await has(u('b')), c: await has(u('c')), used: s.kept() };
  await s.cachePut(c, u('huge'), blob(700), '', lim);
  const huge = await has(u('huge'));
  await s.cachePut(c, 'https://books.bsds.local/books/x/a?g=2', blob(100), '', lim);
  const regen = { old: await has(u('a')), fresh: await has('https://books.bsds.local/books/x/a?g=2') };
  await s.clearKept();
  return { afterCap, huge, regen, cleared: s.kept() };
});
ok(kept.afterCap.a && kept.afterCap.c && !kept.afterCap.b,
  'THE POINT: over the cap, the book opened longest ago goes - not the one just used', JSON.stringify(kept.afterCap));
ok(kept.afterCap.used <= 1000, 'and what is kept stays under the cap', String(kept.afterCap.used));
ok(!kept.huge, 'a file too big to keep is shown but not kept');
ok(!kept.regen.old && kept.regen.fresh, 'a re-uploaded file replaces its old copy rather than sitting beside it');
ok(kept.cleared === 0, 'Clear gives all the space back');

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
const fold = await page.evaluate(() => [...document.querySelectorAll('details.bsec')]
  .map(d => (d.classList.contains('papers') ? 'papers:' : 'fold:') + (d.open ? 'open' : 'shut')));
ok(fold.join() === 'fold:shut,fold:shut,papers:shut',
  'manuals are folded away and the CD paperwork is in a closed pile', fold.join());
ok(!(await page.isVisible('[data-bfile="info/warranty.pdf"]')), 'so a warranty is not in anyone’s way');
const spVisible = await page.isVisible('[data-bfile="sp/16.pdf"]');
ok(spVisible, 'while the spare-parts chapters are right there');

/* a shared manual opens from the one copy, in the other book's folder */
await page.click('details.bsec:nth-of-type(2) summary').catch(() => {});
await tap({ 'data-bfile': 'cat/PM engine.pdf', 'data-book': 'tm-ranger-dx800-t4-47047' });
await page.waitForFunction(() => /Page 1 of 2/.test((document.getElementById('pvpos') || {}).textContent || ''),
  null, { timeout: 20000 }).catch(() => {});
ok(/Page 1 of 2/.test(await page.textContent('#pvpos').catch(() => '')),
  'THE POINT: a shared manual opens from the single stored copy');
await tap({ 'data-openbook': 'tm-ranger-dx800-t4-47047', 'data-for': '3-rivers-drilling-blasting--DR617' });
await page.waitForTimeout(400);
await page.fill('#bpq', '00302748');
await page.waitForTimeout(500);
const hitTxt = await page.textContent('#bphits');
ok(/00302748/.test(hitTxt) && /Ch 16/.test(hitTxt), 'a part number goes straight to its chapter', hitTxt.slice(0, 120));
await page.click('#bphits [data-bfile="sp/16.pdf"]');
const pos = () => page.textContent('#pvpos').catch(() => '');
await page.waitForFunction(() => /Page 3 of 3/.test((document.getElementById('pvpos') || {}).textContent || ''),
  null, { timeout: 20000 }).catch(() => {});
ok(/Page 3 of 3/.test(await pos()),
  'THE POINT: a searched part opens on the page it is printed on, not the contents', await pos());
await page.waitForFunction(() => / is on page /.test((document.getElementById('pvmsg') || {}).textContent || ''),
  null, { timeout: 10000 }).catch(() => {});
const found = (await page.textContent('#pvmsg').catch(() => '')) || '';
ok(/00302748/.test(found) && /page 3/i.test(found) && /tap ‹/.test(found),
  'and says which page, and where to look for the drawing', found.slice(0, 140));
const drawn = await page.evaluate(() => {
  const c = document.getElementById('pvcanvas');
  return !!c && c.width > 300 && c.height > 300;
});
ok(drawn, 'the page is drawn in the app, not handed off');
await page.click('#pvprev');
await page.waitForTimeout(500);
ok(/Page 2 of 3/.test(await pos()), 'one tap back is the drawing', await pos());
const openHref = await page.getAttribute('#bopen', 'href');
ok(/^blob:/.test(openHref || ''), 'Open and Save are still there as a way out', openHref);

/* the index writes a revision letter the printed page does not:
   05502008f in the index, "055 020 08" on the page */
await page.evaluate(() => sessionStorage.removeItem('bsds.partsBasket'));
await tap({ 'data-bfile': 'sp/16.pdf', 'data-book': 'tm-ranger-dx800-t4-47047', 'data-part': '05502008f' });
await page.waitForFunction(() => / is on page /.test((document.getElementById('pvmsg') || {}).textContent || ''),
  null, { timeout: 20000 }).catch(() => {});
ok(/Page 2 of 3/.test(await pos()),
  'THE POINT: a part the index writes with a revision letter still opens on its page', await pos());
await tap({ 'data-bfile': 'sp/16.pdf', 'data-book': 'tm-ranger-dx800-t4-47047', 'data-part': '00302748' });
await page.waitForFunction(() => / is on page /.test((document.getElementById('pvmsg') || {}).textContent || ''),
  null, { timeout: 20000 }).catch(() => {});

/* ---- from the page to a parts request ---------------------------------- */
await page.evaluate(() => sessionStorage.removeItem('bsds.partsBasket'));
await page.click('#pvadd');
await page.click('#pvadd');
ok(/2 of them/.test(await page.textContent('#pvadd')), 'a second tap adds one more, not a second line',
  await page.textContent('#pvadd'));
ok(!!(await page.$('.basketbar')), 'and the parts waiting to order are shown');
await page.click('.basketbar');
await page.waitForTimeout(500);
const form = await page.evaluate(() => ({
  unit: (document.getElementById('p_unit') || {}).value,
  rows: [...document.querySelectorAll('#partlines .partrow')].map(r =>
    ['pn', 'qty', 'desc'].map(c => r.querySelector('[data-col="' + c + '"]').value)),
}));
ok(form.rows.length === 1 && form.rows[0][0] === '00302748' && form.rows[0][1] === '2',
  'THE POINT: the part lands on a parts request, number and quantity filled in', JSON.stringify(form.rows));
ok(form.rows[0][2] === 'Pin', 'with what it is, from the book’s index', form.rows[0][2]);
ok(form.unit === 'DR617', 'for the machine the book was opened from', form.unit);
await tap({ 'data-bookfor': '3-rivers-drilling-blasting--DR617' });
await tap({ 'data-openbook': 'tm-ranger-dx800-t4-47047', 'data-for': '3-rivers-drilling-blasting--DR617' });
/* a chapter opened from the contents list, with no part, starts at the start */
await tap({ 'data-bfile': 'sp/16.pdf', 'data-book': 'tm-ranger-dx800-t4-47047' });
await page.waitForFunction(() => /Page 1 of 3/.test((document.getElementById('pvpos') || {}).textContent || ''),
  null, { timeout: 20000 }).catch(() => {});
ok(/Page 1 of 3/.test(await pos()), 'a chapter opened from its list starts on page 1', await pos());
const leaks = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
  .filter(a => /firebasestorage|token=/.test(a.href)).length);
ok(leaks === 0, 'no shareable storage link is ever put on the page');

/* ---- Machines → customer → rig → book ---------------------------------- */
await tap({ 'data-cust': '3-rivers-drilling-blasting' });
await page.waitForTimeout(1200);
const custRow = await page.evaluate(() => {
  const r = document.querySelector('[data-rig="3-rivers-drilling-blasting--DR617"]');
  return r ? r.textContent : '';
});
ok(/book/.test(custRow), 'on the customer’s list, a rig whose book is in the app says so', custRow);
await tap({ 'data-rig': '3-rivers-drilling-blasting--DR617' });
await page.waitForTimeout(800);
ok(!!(await page.$('#rigbook [data-openbook="tm-ranger-dx800-t4-47047"][data-for="3-rivers-drilling-blasting--DR617"]')),
  'THE POINT: the rig page opens its own book');
ok(!/No parts book/.test(await page.textContent('#rigbook')), 'and no longer says it has none');
await tap({ 'data-rig': 'wesco-ut--70165' });
await page.waitForTimeout(800);
ok(!!(await page.$('#rigbook [data-openbook="epiroc-70165"]')), 'a DM45 rig opens its converted book the same way');
await tap({ 'data-rig': 'top-rock-blasting--1' });
await page.waitForTimeout(800);
ok(/No parts book/.test(await page.textContent('#rigbook').catch(() => '')) && !(await page.$('#rigbook [data-openbook]')),
  'a rig with no book says so plainly, and offers nothing that is not its book');

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
const hasSave = fr ? await fr.evaluate(() => typeof (window.claude && window.claude.use)) : '';
ok(hasSave === 'function', 'the book’s own save has somewhere to go again', hasSave);

/* its tray goes onto a parts request */
await page.evaluate(() => sessionStorage.removeItem('bsds.partsBasket'));
await page.click('#pgsend');
await page.waitForTimeout(800);
const epForm = await page.evaluate(() => ({
  unit: (document.getElementById('p_unit') || {}).value,
  rows: [...document.querySelectorAll('#partlines .partrow')].map(r =>
    ['pn', 'qty', 'desc'].map(c => r.querySelector('[data-col="' + c + '"]').value)),
}));
ok(epForm.rows.length === 1 && epForm.rows[0][0] === '5112 3345 00' && epForm.rows[0][1] === '2'
  && epForm.rows[0][2] === 'HOSE',
  'THE POINT: a converted book’s list lands on a parts request', JSON.stringify(epForm.rows));
ok(epForm.unit === 'D-43', 'with the unit typed into the book', epForm.unit);
await page.evaluate(() => sessionStorage.removeItem('bsds.partsBasket'));

/* the library screen lists what is in the app instead of linking out */
await tap({ 'data-go': 'books' });
await page.waitForTimeout(400);
/* blue tiles are parts books; the teal shelf of schematics and manuals is
   not part of this move and still links out */
const libLinks = await page.$$eval('a.tile.blue[href*="claude.ai/artifact"]', a => a.map(x => x.href));
ok(libLinks.length === 0, 'a book that is in storage no longer sends anyone to claude.ai', libLinks.join(' '));
ok((await page.$$('[data-openbook]')).length === stored.length, 'every stored book is on the library screen');
const shelfLinks = await page.$$eval('a.tile.teal[href*="claude.ai/artifact"]', a => a.map(x => x.href));
ok(shelfLinks.length === 0, 'and no schematic or manual sends anyone to claude.ai any more', shelfLinks.join(' '));
ok((await page.$$('a.tile.teal[href*="drive.google.com"]')).length === 1,
  'the Drive folder, which is not a page, still links out');

/* a manual opens in the app, without a parts-request button it has no use for */
await tap({ 'data-openbook': 'shelf-which-manual' });
await page.waitForTimeout(500);
ok(!!(await page.$('.frame iframe')), 'a manual opens inside the app');
ok(!(await page.$('#pgsend')), 'with no "send to a parts request" - a manual has no tray');
const shelfMatch = await page.evaluate(async () => {
  const s = await import('./bookstore.js');
  return s.bySerial('').length + s.list().filter(b => b.shelf && b.serial).length;
});
ok(shelfMatch === 0, 'no manual carries a serial a machine could match');

/* the library screen says what this phone is holding, and can give it back */
await tap({ 'data-go': 'books' });
await page.waitForTimeout(400);
const keptNote = await page.textContent('#keptnote').catch(() => '');
ok(/Books on this phone: .*of 300 MB/.test(keptNote), 'the library says how much this phone is keeping',
  keptNote.slice(0, 80));

/* ---- a tech calls off a parts request he does not need ----------------- */
await page.click('#signout');
await page.waitForTimeout(300);
await page.click('[data-demo="demo-clint"]');
await page.waitForTimeout(300);
await page.evaluate(() => sessionStorage.removeItem('bsds.partsBasket'));
await tap({ 'data-go': 'parts' });
await page.click('.urg .res');
await page.fill('#p_unit', 'DR617');
await page.fill('#partlines .partrow [data-col="pn"]', '00302748');
await page.fill('#partlines .partrow [data-col="qty"]', '1');
await page.click('#psend');
await page.waitForTimeout(800);
ok(!!(await page.$('[data-cancelreq]')), 'THE POINT: whoever asked can cancel his own open request');
page.once('dialog', d => d.accept());
await page.click('[data-cancelreq]');
await page.waitForTimeout(800);
const after = await page.textContent('#view');
ok(/Cancelled/.test(after) && /by Clint/.test(after), 'it is marked cancelled, and by whom', after.slice(0, 120));
ok(!(await page.$('[data-cancelreq]')), 'and cannot be cancelled twice');

/* a list picked from a book can be thrown away without sending it */
await page.evaluate(async () => {
  const s = await import('./bookstore.js');
  s.basketAdd([{ pn: 'X1', qty: 1, desc: 'not wanted' }], 'DR617');
});
await tap({ 'data-go': 'parts' });
ok(!!(await page.$('#pbclear')), 'a list from a book can be thrown away');
await page.click('#pbclear');
await page.waitForTimeout(300);
ok(await page.evaluate(() => !sessionStorage.getItem('bsds.partsBasket')), 'and it is gone');

const real = errs.filter(e => !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(e));
ok(real.length === 0, 'no script errors', real.slice(0, 2).join(' | '));

await ctx.close();
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
