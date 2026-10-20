/* The band on the home screen: what is waiting on whoever just opened the app.
 *
 * The thing this suite is really protecting is RESTRAINT. A band is only
 * worth reading while it is short, and the first line people learn to skip
 * is the one that is there every single day. So there are checks here that
 * an empty shop shows NO band at all, and that a tech does not get the
 * shop's lines - both of which are easy to break by adding something
 * helpful.
 *
 * It also pins the ordering: a rig that is not drilling sits above a part
 * number somebody needs to look up, always.
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
  /* The app icons live at the SITE root, one level above /app/, which is
     where they really are in production. The harness serves this folder as
     the root, so stand them in rather than let the app look broken. */
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

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

for (const size of [{ width: 390, height: 844 }, { width: 1200, height: 900 }]) {
  const tag = `${size.width}px`;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(BASE);
  await page.waitForTimeout(300);

  const be = async (uid) => {
    await page.evaluate(u => { sessionStorage.setItem('bsds.demoUser', u); }, uid);
    await page.reload();
    await page.waitForTimeout(900);
  };
  const wipe = async () => {
    await page.evaluate(() => {
      ['bsds.partsRequests', 'bsds.partsOrders', 'bsds.preops', 'bsds.jsas',
       'bsds.equipment', 'bsds.customers'].forEach(k => sessionStorage.removeItem(k));
    });
  };
  const band = async () => {
    await page.waitForTimeout(900);
    return (await page.locator('.alert').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
  };
  /* put a request straight into the demo store, the way the app would */
  const seedRequest = async (uid, urgency, unit, pn) => {
    await page.evaluate(([u, g, un, p]) => {
      const k = 'bsds.partsRequests';
      const rows = JSON.parse(sessionStorage.getItem(k) || '[]');
      rows.unshift({ id: 'seed-' + rows.length + '-' + Date.now(), uid: u, byName: 'Seed',
        unit: un, urgency: g, status: 'open', orderId: '',
        lines: [{ pn: p, qty: 1, desc: 'a thing' }],
        createdAt: new Date().toISOString() });
      sessionStorage.setItem(k, JSON.stringify(rows));
    }, [uid, urgency, unit, pn]);
  };
  const seedDefect = async (uid) => {
    await page.evaluate((u) => {
      const k = 'bsds.preops';
      const rows = JSON.parse(sessionStorage.getItem(k) || '[]');
      rows.unshift({ id: 'sd-' + rows.length + '-' + Date.now(), uid: u, byName: 'Seed',
        unit: '8619', form: 'preop', formVersion: 1, hold: false, result: 'fail',
        inspDate: new Date().toISOString(), createdAt: new Date().toISOString(),
        passes: 25, fails: 1, nas: 0,
        items: [{ s: 'Fluids & Engine', i: 'Coolant level', r: 'fail', n: 'low' }] });
      sessionStorage.setItem(k, JSON.stringify(rows));
    }, uid);
  };

  // ---- a quiet shop shows no band at all --------------------------
  await be('demo-mike');
  await wipe();
  await page.reload();
  await page.waitForTimeout(1200);
  const quiet = await band();
  ok(quiet.filter(x => !/no serial/i.test(x)).length === 0,
    `${tag} a quiet shop shows nothing but the standing serial note`, quiet.join(' | '));

  // ---- a rig down is the loudest thing on the screen --------------
  await seedRequest('demo-clint', 'down', '70165', 'R32-BIT-51');
  await seedRequest('demo-clint', 'stock', '8619', '');
  await page.reload();
  await page.waitForTimeout(1400);
  let b = await band();
  ok(/1 rig down waiting on parts/i.test(b[0] || ''),
    `${tag} a rig down sorts to the top`, b.join(' | '));
  ok(/70165/.test(b[0] || ''), `${tag} and names the machine`);
  ok(await page.locator('.alert.stop').count() >= 1,
    `${tag} and is drawn as something that stops work`);
  ok(b.some(x => /1 parts request to order/i.test(x)),
    `${tag} the non-urgent one is listed separately`, b.join(' | '));
  ok(b.some(x => /part number to find/i.test(x)),
    `${tag} and the one with no part number is counted`, b.join(' | '));
  const stopIdx = b.findIndex(x => /rig down/i.test(x));
  const noteIdx = b.findIndex(x => /part number to find/i.test(x));
  ok(stopIdx >= 0 && noteIdx > stopIdx,
    `${tag} a down rig always sits above a lookup`, `${stopIdx} vs ${noteIdx}`);

  // ---- clicking takes you to the thing ----------------------------
  await page.locator('.alert.stop').first().click();
  await page.waitForTimeout(900);
  ok(/PARTS/i.test(await page.locator('#ttl').innerText()),
    `${tag} the band is a way in, not just a sign`,
    await page.locator('#ttl').innerText());

  // ---- an uncorrected defect counts as stop-work ------------------
  await seedDefect('demo-clint');
  await page.reload();
  await page.waitForTimeout(1400);
  b = await band();
  ok(b.some(x => /1 defect nobody has signed off/i.test(x)),
    `${tag} an uncorrected defect is on the band`, b.join(' | '));
  ok(await page.locator('.alert.stop').count() === 2,
    `${tag} and counts as something that stops work`,
    String(await page.locator('.alert.stop').count()));

  // ---- office sees the shop, not the fleet chores -----------------
  await be('demo-jaz');
  await page.waitForTimeout(1200);
  b = await band();
  ok(b.some(x => /rig down/i.test(x)), `${tag} office sees the down rig too`, b.join(' | '));
  ok(!b.some(x => /no serial/i.test(x)),
    `${tag} but not the serials, which are not hers to fix`, b.join(' | '));

  // ---- a tech sees only his own, and only what he can still act on
  await be('demo-clint');
  await page.waitForTimeout(1200);
  b = await band();
  ok(!b.some(x => /rig down/i.test(x) || /signed off/i.test(x)),
    `${tag} a tech gets none of the shop's lines`, b.join(' | '));
  ok(b.some(x => /2 parts requests not ordered yet/i.test(x)),
    `${tag} just his own that are still waiting`, b.join(' | '));
  ok(await page.locator('.alert.stop').count() === 0,
    `${tag} and nothing shouting at him`);

  await be('demo-noah');
  await page.waitForTimeout(1200);
  b = await band();
  ok(b.length === 0, `${tag} a tech with nothing outstanding gets no band at all`,
    b.join(' | '));

  const real = errs.filter(e =>
    !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.googleapis|favicon/.test(e));
  ok(real.length === 0, `${tag} no script errors`, real.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
