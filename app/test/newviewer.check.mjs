/* The new Sandvik viewer, end to end, against a real book.
 *
 * A converted Epiroc book is one self-contained file. A Sandvik book is a
 * page plus a few hundred exploded views, far too much to inline, and the
 * page runs in a sealed frame with no sign-in of its own. So it asks the app
 * for one drawing at a time and the app fetches it the way it fetches
 * everything else - with the user's account, cached on the device.
 *
 * This proves the whole chain on 39376: the page opens, a drawing actually
 * arrives through that bridge and paints, a balloon on the drawing picks out
 * its row, the book's order list reaches a parts request, and a page asking
 * for something that is not one of its own drawings is refused.
 *
 *   node test/newviewer.check.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOOK = process.argv[2] || '39376';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml',
                '.jpg': 'image/jpeg', '.png': 'image/png' };

let pass = 0, fail = 0;
const ok = (c, what, extra) => {
  if (c) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what + (extra ? '  <' + extra + '>' : '')); }
};

/* The app over http, with one change: the Firebase key is blanked so the app
   runs in demo mode and reads books from books-demo/ instead of Cloud
   Storage. Every other line of it, the bridge included, is the shipping one. */
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  const t = TYPES[path.extname(f)] || 'application/octet-stream';
  if (rel === 'config.js') {
    const s = fs.readFileSync(f, 'utf8').replace(/apiKey: '[^']*'/, "apiKey: ''");
    res.writeHead(200, { 'content-type': t }); res.end(s); return;
  }
  res.writeHead(200, { 'content-type': t }); res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, r));
const BASE = 'http://127.0.0.1:' + srv.address().port + '/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));

/* every request the page makes for a drawing, so we can prove the frame is
   NOT reaching the files directly - it has no business being able to */
const direct = [];
page.on('request', r => {
  if (!/\/books-demo\/.*\/draw\//.test(r.url())) return;
  if (r.frame() !== page.mainFrame()) direct.push(r.url());   /* the FRAME reaching out */
});

try {
  await page.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' });
  /* sign in as a technician - the book has to work for the person in the pit */
  await page.locator('button,a').filter({ hasText: 'Clint' }).first().click();
  await page.waitForTimeout(500);
  /* the route a tech actually takes: the rig, not the library */
  await page.locator('[data-go="equipment"]').first().click();
  await page.waitForTimeout(600);
  const viaRig = await page.evaluate(async () => {
    const click = re => {
      const hit = [...document.querySelectorAll('button,a')]
        .find(b => re.test(b.textContent || ''));
      if (hit) hit.click();
      return !!hit;
    };
    if (!click(/Fisher/i)) return 'no customer';
    await new Promise(r => setTimeout(r, 500));
    if (!click(/110245/)) return 'no rig';
    await new Promise(r => setTimeout(r, 800));
    const open = document.querySelector('[data-openbook]');
    return open ? open.dataset.openbook : 'no book button';
  });
  ok(viaRig === BOOK, "opening the rig's own book reaches the read one, not the PDFs",
    String(viaRig));

  /* and from the library */
  await page.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-go="books"]').first().click();
  await page.waitForTimeout(800);
  const tile = page.locator('[data-openbook="' + BOOK + '"]');
  ok(await tile.count() > 0, 'a technician sees the book in the library');
  /* one book per machine in the library - opening the wrong one of a pair is
     how somebody ends up panning a chapter PDF wondering where search went */
  const twins = await page.locator('[data-openbook]').evaluateAll(els =>
    els.map(e => e.dataset.openbook));
  ok(new Set(twins).size === twins.length, 'the library lists each book once',
    twins.join(','));
  await tile.first().click();
  await page.waitForSelector('iframe', { timeout: 20000 });
  const frame = page.frameLocator('iframe');
  await frame.locator('#q').waitFor({ timeout: 20000 });
  ok(true, 'the book page opens in the app');

  /* open an assembly that has an exploded view */
  await frame.locator('.ab').first().click();
  const img = frame.locator('.figi img').first();
  await img.waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const shot = await img.evaluate(el => ({
    src: (el.getAttribute('src') || '').split(':')[0],
    complete: el.complete,
    w: el.naturalWidth, h: el.naturalHeight, pending: el.hasAttribute('data-src'),
  }));
  ok(shot.src === 'blob', 'the drawing arrives as a blob from the app, not a path', shot.src);
  ok(!shot.pending, 'its data-src was resolved');
  ok(shot.w > 1000 && shot.h > 1000, 'and it decoded',
    shot.w + 'x' + shot.h + ' complete=' + shot.complete);
  ok(direct.length === 0, 'the sealed frame never reached the files itself', direct[0] || '');

  await frame.locator('.fig').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ROOT, 'test', 'newviewer-book.png') });

  /* a balloon on the drawing picks out its row */
  const hs = frame.locator('.hs');
  const n = await hs.count();
  ok(n > 0, 'the drawing has callouts', String(n));
  /* pick one the parts table actually lists - a drawing's title block can
     read as a callout, and one that matches no row has nothing to mark */
  const want = await frame.locator('body').evaluate(() => {
    const rows = new Set([...document.querySelectorAll('tbody tr[data-ref]')]
      .map(r => r.getAttribute('data-ref')));
    const hit = [...document.querySelectorAll('.hs')]
      .map(b => b.getAttribute('data-ref')).find(r => rows.has(r));
    return hit || null;
  });
  ok(!!want, 'at least one callout matches a row in the table', String(want));
  /* the invariant: every hotspot on the drawing does something when tapped.
     The reader also picks up the digits of the title-block part number, and
     sub-assemblies the CD sells whole have internals it never lists; neither
     gets a button. */
  const dead = await frame.locator('body').evaluate(() => {
    const rows = new Set([...document.querySelectorAll('tbody tr[data-ref]')]
      .map(r => r.getAttribute('data-ref')));
    return [...document.querySelectorAll('.hs')]
      .map(b => b.getAttribute('data-ref')).filter(r => !rows.has(r));
  });
  ok(dead.length === 0, 'and every callout on the drawing has a row behind it',
    dead.slice(0, 6).join(','));
  if (want) {
    await frame.locator('.hs[data-ref="' + want + '"]').first().click({ force: true });
    await page.waitForTimeout(300);
    const got = await frame.locator('tbody tr.hot').first().getAttribute('data-ref').catch(() => null);
    ok(got === want, 'tapping callout ' + want + ' marks its row', String(got));
  }

  /* a page asking for something that is not one of its own drawings is
     refused by the app, not by the page - the page is the untrusted half */
  const probes = await frame.locator('body').evaluate(async () => {
    const tryOne = p => window.bsdsFile(p).then(() => 'ALLOWED', e => 'refused: ' + e.message);
    return {
      up:    await tryOne('../' + 'book.json'),
      out:   await tryOne('books/39376/book.json'),
      slash: await tryOne('draw/../../book.json'),
      good:  await tryOne('draw/p000.jpg').then(u => String(u).slice(0, 5)),
    };
  });
  ok(probes.up.startsWith('refused'), 'a path climbing out of draw/ is refused', probes.up);
  ok(probes.out.startsWith('refused'), 'a path to another object is refused', probes.out);
  ok(probes.slash.startsWith('refused'), 'a path with .. in it is refused', probes.slash);
  ok(probes.good === 'refus' ? false : true, 'a real drawing is still served', probes.good);

  /* the book's order list reaches a parts request */
  /* several parts off the same drawing, which is the normal case - a seal,
     the screws that hold it and the washers under them all go on one request */
  /* dispatched rather than clicked by coordinate: the rows run well past the
     bottom of a phone, and a forced click at a scrolled-away point lands on
     whatever is there instead */
  const adds = frame.locator('.addb');
  const many = Math.min(3, await adds.count());
  for (let i = 0; i < many; i++) await adds.nth(i).dispatchEvent('click');
  const twice = await adds.first().getAttribute('data-pn');
  await adds.first().dispatchEvent('click');        /* the same part twice */
  await page.waitForTimeout(300);
  const tray = await frame.locator('body').evaluate(() => ({
    cols: window.COLS || null,
    rows: typeof window.orderRows === 'function' ? window.orderRows() : null,
  }));
  ok(Array.isArray(tray.rows) && tray.rows.length === many,
    'the book hands over all ' + many + ' parts, not just the last one',
    JSON.stringify(tray.rows));
  /* the sheet lists parts by number, not by the order they were tapped -
     part numbers are integer-like keys, so the browser sorts them */
  const twiceRow = (tray.rows || []).find(r => String(r[0]) === twice);
  ok(twiceRow && String(twiceRow[1]) === '2',
    'and the one tapped twice comes over as qty 2', JSON.stringify(twiceRow));
  ok(tray.cols && tray.cols[0] === 'Order number',
    'by the column names the app matches on', JSON.stringify(tray.cols));
  await page.locator('#pgsend').click();
  await page.waitForTimeout(600);
  const basket = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('bsds.partsBasket') || 'null'));
  ok(basket && basket.lines.length === many,
    'THE POINT: all ' + many + ' land on one parts request',
    JSON.stringify(basket && basket.lines));
  const twiceLine = basket && basket.lines.find(l => l.pn === twice);
  ok(twiceLine && Number(twiceLine.qty) === 2,
    'with their numbers and quantities intact', JSON.stringify(twiceLine));
  ok(basket && basket.unit === '110245', 'with the machine it came off filled in',
    basket && basket.unit);

  await page.screenshot({ path: path.join(ROOT, 'test', 'newviewer.png') });
  console.log('  screenshots: test/newviewer-book.png (the book), test/newviewer.png (the request)');
} finally {
  ok(errs.length === 0, 'no script errors on the page', errs.slice(0, 2).join(' | '));
  await browser.close();
  srv.close();
}
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
