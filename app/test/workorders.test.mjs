/* Work order requests: the round trip from a phone call to a service order.
 *
 * The thing worth testing here is the ROUND TRIP, not the form. A tech
 * rings in a problem and then has no idea whether anything happened;
 * getting the service order number back onto his own screen, without him
 * ringing anybody, is the entire point of building this rather than leaving
 * it as a phone call. So most of what follows is one journey: Clint raises
 * it, Jazmine builds it in Fullbay and types the number, and it has to be
 * sitting on Clint's screen when he next looks.
 *
 * Also pinned: the complaint is free text. Nobody rings up with a part
 * number - they ring up and say the compressor is making a noise - and a
 * dropdown there would throw away the only thing the caller actually said.
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
  const goHome = async () => {
    for (let i = 0; i < 7; i++) {
      if (await page.locator('.tile b').count() > 0) return;
      if (await page.locator('#back').isHidden()) return;
      await page.locator('#back').click();
      await page.waitForTimeout(320);
    }
  };
  const nav = async () =>
    (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());
  const setW = async (k, v) => {
    await page.evaluate(([a, b]) => {
      const el = document.querySelector('[data-w="' + a + '"]');
      el.value = b;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [k, v]);
  };
  const wmsg = async () => (await page.locator('#wmsg').count())
    ? ((await page.locator('#wmsg').textContent()) || '') : '';

  // ---- a tech can raise one ---------------------------------------
  await be('demo-clint');
  const tiles = (await page.locator('.tile b').allTextContents()).map(s => s.trim());
  ok(tiles.includes('Work Order'), `${tag} a tech has the work order button`,
    tiles.join(', '));
  let n = await nav();
  ok(n.includes('My work orders'), `${tag} and a list of his own`, n.join(', '));

  await page.evaluate(() => {
    [...document.querySelectorAll('.tile')]
      .find(t => t.querySelector('b') && t.querySelector('b').textContent.trim() === 'Work Order')
      .click();
  });
  await page.waitForTimeout(800);
  ok(await page.locator('#wform').count() === 1, `${tag} the form draws`);
  ok(await page.locator('[data-w="complaint"]').evaluate(e => e.tagName) === 'TEXTAREA',
    `${tag} the complaint is free text, not a dropdown`);
  ok(await page.locator('#wcusts option').count() > 0, `${tag} customers are offered`);
  ok(await page.locator('#wunits option').count() > 0, `${tag} machines are offered`);

  // what it refuses
  await page.locator('#wsend').click();
  await page.waitForTimeout(400);
  let m = await wmsg();
  ok(/Customer is needed/.test(m), `${tag} it needs a customer`, m.replace(/\n/g, ' | '));
  ok(/Who called is needed/.test(m), `${tag} and who rang`);
  ok(!/PO number is needed/.test(m), `${tag} but NOT a PO - often there is not one`);
  ok(!/Assigned tech is needed/.test(m), `${tag} nor an assignment - that is the office's`);
  ok(await page.locator('.badfield').count() === 1,
    `${tag} and it points at the first thing to fix`);

  await setW('customer', 'WESCO - UT');
  await setW('location', 'Kennecott APEX');
  await setW('unit', '70165');
  await setW('complaint', 'Compressor making a noise on start up, blowing oil out the breather');
  await setW('calledBy', 'Tom Campbell');
  await page.locator('#wsend').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('.sheet').count() === 1, `${tag} a complete request files`,
    (await wmsg()).slice(0, 110));
  const sheet = await page.locator('.sheet').innerText();
  ok(/OPEN/.test(await page.locator('.stamp').textContent()),
    `${tag} and comes back open`);
  ok(/Kennecott APEX/.test(sheet), `${tag} with the location`);
  ok(/blowing oil out the breather/.test(sheet),
    `${tag} and the caller's own words, not a summary`);
  ok(/Tom Campbell/.test(sheet), `${tag} and who rang`);
  ok(/70165/.test(sheet), `${tag} against the machine, serial pulled in`);
  ok(/none given/i.test(sheet), `${tag} the empty PO says so rather than looking blank`);
  ok(await page.locator('a.mini').count() === 1, `${tag} Fullbay is one tap away`);
  ok(await page.locator('[data-built]').count() === 0,
    `${tag} but a tech cannot raise the service order himself`);

  // ---- another tech sees none of it -------------------------------
  await be('demo-noah');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My work orders/.test(r.textContent)).click();
  });
  await page.waitForTimeout(700);
  ok(await page.locator('[data-wo]').count() === 0,
    `${tag} another tech sees none of Clint's`);

  // ---- office builds it -------------------------------------------
  await be('demo-jaz');
  n = await nav();
  ok(n.includes('Work orders'), `${tag} office gets the list`, n.join(', '));
  ok(!(await page.locator('.tile b').allTextContents())
      .map(s => s.trim()).includes('Work Order'),
    `${tag} and does not raise them - that is techs and owners`);
  await page.locator('.list .row[data-go="wolist"]').click();
  await page.waitForTimeout(800);
  const spec = (await page.locator('.spec').innerText()).replace(/\s+/g, ' ');
  ok(/1 to build/i.test(spec), `${tag} one waiting to be built`, spec);
  await page.locator('[data-wo]').first().click();
  await page.waitForTimeout(800);
  ok(await page.locator('[data-built]').count() === 1,
    `${tag} office can raise the service order`);

  await page.locator('[data-built]').click();
  await page.waitForTimeout(500);
  ok(/service order number/i.test(await page.locator('#womsg').textContent()),
    `${tag} and it will not be marked built without the number`,
    await page.locator('#womsg').textContent());
  await page.fill('#w_so', 'SO-88241');
  await page.fill('#w_assign', 'Clint');
  await page.locator('[data-built]').click();
  await page.waitForTimeout(1400);
  ok(/SO-88241/.test(await page.locator('.stamp').textContent()),
    `${tag} the number goes on the record`,
    await page.locator('.stamp').textContent());

  // ---- THE POINT: it is waiting for Clint without anybody ringing him
  await be('demo-clint');
  await page.waitForTimeout(1200);
  const band = (await page.locator('.alert').allTextContents()).join(' | ');
  ok(/SO-88241/.test(band),
    `${tag} THE POINT: the service order number is on his home screen`, band);
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My work orders/.test(r.textContent)).click();
  });
  await page.waitForTimeout(800);
  const his = await page.locator('#view').innerText();
  ok(/SO-88241/.test(his), `${tag} and on his list`, his.replace(/\s+/g, ' ').slice(0, 110));
  ok(!/waiting/i.test(his.split('Done')[0] || ''),
    `${tag} and off his waiting pile`);

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
