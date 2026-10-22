/* Parts, in a real browser: a tech asks, the office orders, somebody receives.
 *
 * Two things this is really checking.
 *
 * The first is that A LINE WITH NO PART NUMBER GETS THROUGH, and is flagged.
 * That is deliberate and easy to "fix" into a bug later: half the time the
 * tech knows what the thing is and not what it is called, and forcing a
 * number out of him produces a guessed number, which is worse than a
 * description and a lookup. So there is a test here whose job is to fail if
 * somebody ever makes the part number required.
 *
 * The second is that the three states stay honest end to end - a request a
 * tech raised says "On order" to HIM once the office buys it, and "Received"
 * once it lands, without anybody telling him.
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
  /* the build sandbox keeps its own Chromium; anywhere else, Playwright's */
  ...(fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } : {}),
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

  /* keeps the demo store - the whole point is that one person's request is
     still there when somebody else signs in */
  const be = async (uid) => {
    await page.evaluate(u => { sessionStorage.setItem('bsds.demoUser', u); }, uid);
    await page.reload();
    await page.waitForTimeout(600);
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
  const setP = async (k, v) => {
    await page.evaluate(([a, b]) => {
      const el = document.querySelector('[data-p="' + a + '"]');
      el.value = b;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [k, v]);
  };
  const setLine = async (n, col, v) => {
    await page.evaluate(([a, b, c]) => {
      const el = document.querySelector('.partrow[data-part="' + a + '"] [data-col="' + b + '"]');
      el.value = c;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [String(n), col, v]);
  };
  const pmsg = async () => (await page.locator('#pmsg2').count())
    ? ((await page.locator('#pmsg2').textContent()) || '') : '';

  // ---- tech: the request form -------------------------------------
  await be('demo-clint');
  const t = (await page.locator('.tile b').allTextContents()).map(s => s.trim());
  ok(t.includes('Order Parts'), `${tag} the built-in parts form is on the tiles`);
  ok(t.includes('Order Parts (old app)'),
    `${tag} the old one is still reachable during the changeover`);
  let n = await nav();
  ok(n.includes('My parts requests'), `${tag} a tech sees his own requests`, n.join(', '));
  ok(!n.includes('Parts'), `${tag} and not the shop queue`, n.join(', '));

  await page.evaluate(() => {
    [...document.querySelectorAll('.tile')]
      .find(x => x.querySelector('b') && x.querySelector('b').textContent.trim() === 'Order Parts')
      .click();
  });
  await page.waitForTimeout(700);
  ok(await page.locator('#pform').count() === 1, `${tag} the request form draws`);
  ok(await page.locator('.partrow').count() === 2, `${tag} two part lines to start`);
  ok(await page.locator('.urg .res').count() === 3, `${tag} three urgency choices`);
  ok(await page.locator('#punits option').count() > 0, `${tag} the machines are offered`);

  await page.locator('#psend').click();
  await page.waitForTimeout(300);
  let m = await pmsg();
  ok(/how urgent/i.test(m), `${tag} it asks how urgent before it will send`, m);
  ok(/Which machine/i.test(m), `${tag} and which machine`);
  ok(/at least one part/i.test(m), `${tag} and for at least one part`);

  await page.locator('.urg .res[data-result="down"]').click();
  await setP('unit', '70165');
  await setP('workOrder', 'WO-2210');

  // a line with a quantity and nothing else
  await setLine(1, 'qty', '2');
  await page.locator('#psend').click();
  await page.waitForTimeout(300);
  m = await pmsg();
  ok(/needs a part number or a description/.test(m),
    `${tag} a line with only a quantity is refused`, m.slice(0, 90));

  // a line with a description and no quantity
  await setLine(1, 'desc', '51mm button bit');
  await setLine(1, 'qty', '');
  await page.locator('#psend').click();
  await page.waitForTimeout(300);
  ok(/needs a quantity/.test(await pmsg()), `${tag} and one with no quantity`);

  // ---- THE ONE THAT MUST KEEP PASSING -----------------------------
  // line 1: a description and no part number. This has to go through.
  await setLine(1, 'qty', '2');
  await setLine(1, 'vendor', 'Mincon Inc.');
  // line 2: a proper numbered part
  await setLine(2, 'pn', 'R32-BIT-51');
  await setLine(2, 'qty', '1');
  await setLine(2, 'desc', 'Shank adapter');
  await page.locator('#psend').click();
  await page.waitForTimeout(1200);
  ok(await page.locator('.sheet').count() === 1,
    `${tag} a line with no part number is ACCEPTED, not refused`,
    (await pmsg()).slice(0, 120));
  const sheet = await page.locator('.sheet').innerText();
  ok((await page.locator('.stamp').textContent()).trim() === 'DOWN',
    `${tag} and it comes back stamped DOWN`);
  ok(/70165/.test(sheet), `${tag} against the machine`);
  ok(/WESCO/.test(sheet), `${tag} with the customer filled in from the unit`);
  ok(/WO-2210/.test(sheet), `${tag} and the work order`);
  ok(/to look up/.test(sheet), `${tag} the missing number is marked on the line`);
  ok(/no part number/i.test(await page.locator('#view').innerText()),
    `${tag} and called out, so the office knows to find it`);

  await goHome();
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My parts requests/.test(r.textContent)).click();
  });
  await page.waitForTimeout(700);
  ok(await page.locator('[data-preq]').count() === 1, `${tag} it is on his list`);
  // section headings are uppercased by CSS; innerText reports what renders
  ok(/waiting to be ordered/i.test(await page.locator('#view').innerText()),
    `${tag} waiting to be ordered`);

  // ---- another tech sees none of it -------------------------------
  await be('demo-noah');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My parts requests/.test(r.textContent)).click();
  });
  await page.waitForTimeout(700);
  ok(await page.locator('[data-preq]').count() === 0,
    `${tag} another tech sees none of Clint's requests`);

  // ---- office: the queue ------------------------------------------
  await be('demo-jaz');
  n = await nav();
  ok(n.includes('Parts'), `${tag} office gets the queue`, n.join(', '));
  await page.locator('.list .row[data-go="partsq"], .bar [data-go="partsq"]').click();
  await page.waitForTimeout(800);
  const spec = (await page.locator('.spec').innerText()).replace(/\s+/g, ' ');
  ok(/1 rigs down/i.test(spec), `${tag} the queue counts rigs that are down`, spec);
  ok(/1 to order/i.test(spec), `${tag} and what is waiting`);
  ok(/1 need a number/i.test(spec), `${tag} and what needs a number first`, spec);
  ok(await page.locator('#pickbar').isHidden(),
    `${tag} nothing to do until something is ticked`);

  await page.locator('[data-pick]').first().check();
  await page.waitForTimeout(400);
  ok(await page.locator('#pickbar').isVisible(), `${tag} ticking one offers the order`);
  ok(/this one on an order/.test(await page.locator('#makeorder').textContent()),
    `${tag} and counts what is ticked`);
  await page.locator('#makeorder').click();
  await page.waitForTimeout(800);
  ok(await page.locator('#oform').count() === 1, `${tag} the order form draws`);
  ok(/2 lines/.test(await page.locator('p.lede').innerText()),
    `${tag} carrying both lines of the request`,
    await page.locator('p.lede').innerText());

  await page.locator('#osave').click();
  await page.waitForTimeout(400);
  ok(/who it is being ordered from/.test(await page.locator('#omsg').textContent()),
    `${tag} an order needs a vendor`);
  await page.evaluate(() => {
    const v = document.querySelector('[data-o="vendor"]'); v.value = 'Mincon Inc.';
    const p = document.querySelector('[data-o="po"]'); p.value = 'PO-4471';
  });
  await page.locator('#osave').click();
  await page.waitForTimeout(1400);
  ok((await page.locator('.stamp').textContent()).trim() === 'PLACED',
    `${tag} the order is placed`);
  const ord = await page.locator('.sheet').innerText();
  ok(/Mincon Inc\./.test(ord) && /PO-4471/.test(ord), `${tag} with vendor and PO`);
  ok(/R32-BIT-51/.test(ord), `${tag} and the lines copied onto it`);
  ok(/70165/.test(ord), `${tag} each line saying which machine it is for`);

  // ---- the request followed it -----------------------------------
  await goHome();
  await page.locator('.list .row[data-go="partsq"], .bar [data-go="partsq"]').click();
  await page.waitForTimeout(800);
  const q = await page.locator('#view').innerText();
  ok(/nothing waiting to be ordered/i.test(q),
    `${tag} the queue empties as things go on order`, q.replace(/\s+/g, ' ').slice(0, 70));
  ok(/on order/i.test(q), `${tag} and shows what is on order`);
  ok(await page.locator('[data-pord]').count() === 1, `${tag} the order is listed`);

  await page.locator('[data-pord]').first().click();
  await page.waitForTimeout(800);
  await page.locator('[data-receive]').click();
  await page.waitForTimeout(1400);
  ok((await page.locator('.stamp').textContent()).trim() === 'RECEIVED',
    `${tag} marking it received stamps the order`);

  // ---- and the tech is told without being told -------------------
  await be('demo-clint');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My parts requests/.test(r.textContent)).click();
  });
  await page.waitForTimeout(700);
  const mine = await page.locator('#view').innerText();
  ok(/received/i.test(mine),
    `${tag} THE POINT: the tech's own request says Received without anybody telling him`,
    mine.replace(/\s+/g, ' ').slice(0, 90));
  ok(!/waiting to be ordered/i.test(mine), `${tag} and is off his waiting list`);

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
