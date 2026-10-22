/* Receipts: the coding, not the photo.
 *
 * The photo path is the Apps Script backend that has always worked and is
 * not rebuilt here, so it is not tested here either - there is nothing new
 * to break in it. What IS new is the coding, and the one thing worth
 * proving over and over is that a receipt split across several jobs adds
 * up to the receipt. A split that is a penny out is the error nobody finds
 * until the books are being closed, and it is the only error here that
 * costs money quietly.
 *
 * Also pinned: that a tech can send one in and cannot read the pile back.
 * That was a hard rule from Mike before any of this was built.
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

  const be = async (uid) => {
    await page.evaluate(u => { sessionStorage.setItem('bsds.demoUser', u); }, uid);
    await page.reload();
    await page.waitForTimeout(900);
  };
  const goHome = async () => {
    for (let i = 0; i < 8; i++) {
      if (await page.locator('.tile b').count() > 0) return;
      if (await page.locator('#back').isHidden()) return;
      await page.locator('#back').click();
      await page.waitForTimeout(320);
    }
  };
  const openForm = async () => {
    await goHome();
    await page.evaluate(() => {
      [...document.querySelectorAll('.tile')]
        .find(t => t.querySelector('b')
          && t.querySelector('b').textContent.trim() === 'Send a Receipt').click();
    });
    await page.waitForTimeout(700);
  };
  const setR = async (k, v) => {
    await page.evaluate(([a, b]) => {
      const el = document.querySelector('[data-r="' + a + '"]');
      el.value = b;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [k, v]);
  };
  const setLine = async (i, so, amt) => {
    await page.evaluate(([n, s, a]) => {
      const row = document.querySelectorAll('[data-line]')[n];
      row.querySelector('[data-l="so"]').value = s;
      const el = row.querySelector('[data-l="amount"]');
      el.value = a;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [i, so, amt]);
  };
  const msg = async () => (await page.locator('#rmsg').count())
    ? ((await page.locator('#rmsg').textContent()) || '') : '';

  // ---- the photo goes up as bare base64 ---------------------------
  // Sending the whole "data:image/jpeg;base64,..." string came back from
  // Apps Script as "Exception: could not decode string". The prefix comes
  // off on our side now, the way the Launcher has always done it, and this
  // is here so nobody puts it back.
  const b64 = await page.evaluate(async () => {
    const m = await import('./receipts.js');
    return {
      stripped: m.bareBase64('data:image/jpeg;base64,AAAA'),
      alreadyBare: m.bareBase64('AAAA'),
      pdf: m.bareBase64('data:application/pdf;base64,Zm9v'),
      empty: m.bareBase64(''),
    };
  });
  ok(b64.stripped === 'AAAA', `${tag} the data-url prefix is stripped before sending`,
    JSON.stringify(b64));
  ok(b64.alreadyBare === 'AAAA', `${tag} and stripping bare base64 leaves it alone`);
  ok(b64.pdf === 'Zm9v', `${tag} a PDF receipt strips the same way`);
  ok(b64.empty === '', `${tag} and nothing in gives nothing out rather than throwing`);

  // ---- a tech can send one in -------------------------------------
  await be('demo-clint');
  const tiles = (await page.locator('.tile b').allTextContents()).map(s => s.trim());
  ok(tiles.includes('Send a Receipt'), `${tag} a tech has the receipt button`,
    tiles.join(', '));
  const navRows = (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());
  ok(!navRows.includes('Receipts'), `${tag} but no receipts list — that was Mike's hard rule`,
    navRows.join(', '));

  await openForm();
  ok(await page.locator('#rform').count() === 1, `${tag} the form draws`);
  ok(await page.locator('[data-line]').count() === 1,
    `${tag} one line to start — one job is the usual case`);

  // the standing buckets are offered without any export
  const sos = await page.locator('#rsos option').evaluateAll(os => os.map(o => o.value));
  /* Each option carries the number AND the words, so the list filters
     whether somebody types "1520" or "shop". */
  ok(sos.some(v => /^1521\b/.test(v) && /Fuel/i.test(v)),
    `${tag} fuel is offered by number and by name`, sos.join(' | '));
  ok(sos.some(v => /^1520\b/.test(v) && /Shop supplies/i.test(v)),
    `${tag} and shop supplies the same way`);
  ok(sos.some(v => /^1551\b/.test(v) && /Clint/i.test(v)),
    `${tag} and the trucks are findable by whose they are`);

  // ---- the service order box takes WORDS ---------------------------
  // Mike: "I want to write SHOP SUPPLIES". Standing at a counter you know
  // what you are buying, not that it is service order 1520.
  const soField = await page.evaluate(() => {
    const el = document.querySelector('[data-l="so"]');
    return { inputmode: el.getAttribute('inputmode'), type: el.type,
             placeholder: el.placeholder };
  });
  ok(!soField.inputmode, `${tag} the service order box does not force a number pad`,
    JSON.stringify(soField));
  ok(soField.type === 'text', `${tag} and takes text`);

  const res = await page.evaluate(async () => {
    const m = await import('./receipts.js');
    const r = t => { const x = m.resolveSO(t); return [x.so, x.label, x.free]; };
    return {
      number: r('1520'),
      picked: r('1520 Shop supplies'),
      words: r('SHOP SUPPLIES'),
      lower: r('shop supplies'),
      fuel: r('Fuel'),
      unknown: r('the blue trailer'),
    };
  });
  ok(res.words[0] === '1520', `${tag} THE POINT: typing SHOP SUPPLIES resolves to 1520`,
    JSON.stringify(res.words));
  ok(res.lower[0] === '1520', `${tag} and case makes no difference`);
  ok(res.number[0] === '1520' && res.number[1] === 'Shop supplies',
    `${tag} a bare number still works and picks up its name`);
  ok(res.picked[0] === '1520', `${tag} and so does what the picker inserts`);
  ok(res.fuel[0] === '1521', `${tag} FUEL finds the fuel work order`, JSON.stringify(res.fuel));
  ok(res.unknown[0] === 'the blue trailer' && res.unknown[2] === true,
    `${tag} something nobody recognises is KEPT as written and flagged, not refused`,
    JSON.stringify(res.unknown));

  // ---- what it refuses --------------------------------------------
  await page.locator('#rsend').click();
  await page.waitForTimeout(400);
  let m = await msg();
  ok(/bought from/i.test(m), `${tag} it needs a vendor`, m.slice(0, 90));
  ok(/How much/i.test(m), `${tag} and an amount`);
  ok(await page.locator('.badfield').count() === 1,
    `${tag} and points at the first thing to fix`);

  // ---- THE ONE THAT MATTERS: a split has to add up ----------------
  await setR('vendor', 'NAPA');
  await setR('amount', '385.00');
  await setR('invoiceNumber', 'INV-99');
  await setR('invoiceDate', '2026-10-20');
  await page.evaluate(() => { document.querySelector('[data-r="paymentMethod"]').value = "Mike's Credit Card"; });
  await page.locator('#raddline').click();
  await page.waitForTimeout(250);
  ok(await page.locator('[data-line]').count() === 2, `${tag} a second line can be added`);

  await setLine(0, '1666', '300.00');
  await setLine(1, '1520', '50.00');
  await page.waitForTimeout(250);
  const left = (await page.locator('#rleft').textContent()) || '';
  ok(/35\.00/.test(left), `${tag} it says how much is unaccounted for as you type`, left);

  await page.locator('#rsend').click();
  await page.waitForTimeout(400);
  m = await msg();
  ok(/350\.00/.test(m) && /385\.00/.test(m),
    `${tag} THE POINT: a split that does not add up is refused, with both numbers`,
    m.slice(0, 130));
  ok(/unaccounted/i.test(m), `${tag} and says which way it is out`);

  // over the total, the other direction
  await setLine(1, '1520', '120.00');
  await page.locator('#rsend').click();
  await page.waitForTimeout(400);
  m = await msg();
  ok(/too much/i.test(m), `${tag} and refuses a split that comes to more`, m.slice(0, 110));

  // now make it add up
  await setLine(1, '1520', '85.00');
  await page.waitForTimeout(250);
  const ok2 = (await page.locator('#rleft').textContent()) || '';
  ok(/add up/i.test(ok2), `${tag} and says so when it balances`, ok2);

  await page.locator('#rsend').click();
  /* wait for the record, not a fixed time: a slow PC files slower */
  await page.waitForFunction(() => !document.querySelector('#rsend'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const sheet = await page.locator('#view').innerText();
  ok(/NAPA/.test(sheet), `${tag} a balanced split files`, sheet.replace(/\s+/g, ' ').slice(0, 110));
  ok(/1666/.test(sheet) && /1520/.test(sheet),
    `${tag} and the record shows both jobs it was coded to`);
  ok(/385\.00/.test(sheet), `${tag} with the total on it`);

  // ---- a penny out is still out -----------------------------------
  await openForm();
  await setR('vendor', 'Maverik');
  await setR('amount', '100.00');
  await setR('invoiceDate', '2026-10-20');
  await page.evaluate(() => { document.querySelector('[data-r="paymentMethod"]').value = 'Charge Account'; });
  await page.locator('#raddline').click();
  await page.waitForTimeout(200);
  await setLine(0, '1521', '33.33');
  await setLine(1, '1520', '66.66');
  await page.locator('#rsend').click();
  await page.waitForTimeout(400);
  m = await msg();
  ok(/99\.99/.test(m), `${tag} a penny out is caught, not rounded away`, m.slice(0, 110));

  // ---- a receipt coded in words files, and is flagged --------------
  await openForm();
  await setR('vendor', 'Walmart');
  await setR('amount', '41.20');
  await setR('invoiceDate', '2026-10-21');
  await page.evaluate(() => { document.querySelector('[data-r="paymentMethod"]').value = 'Company Card'; });
  await setLine(0, 'SHOP SUPPLIES', '41.20');
  await page.locator('#rsend').click();
  /* wait for the record, not a fixed time: a slow PC files slower */
  await page.waitForFunction(() => !document.querySelector('#rsend'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const words = await page.locator('#view').innerText();
  ok(/Walmart/.test(words), `${tag} a receipt written in words files`,
    words.replace(/\s+/g, ' ').slice(0, 100));
  ok(/1520/.test(words),
    `${tag} and the record carries the real service order it resolved to`,
    words.replace(/\s+/g, ' ').slice(0, 140));

  // ---- the office works the list ----------------------------------
  await be('demo-jaz');
  const jazNav = (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());
  ok(jazNav.includes('Receipts'), `${tag} office has the receipts list`, jazNav.join(', '));
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /Receipts/.test(r.textContent)).click();
  });
  await page.waitForTimeout(800);
  const queue = await page.locator('#view').innerText();
  ok(/NAPA/.test(queue), `${tag} the receipt the tech sent is waiting on her`,
    queue.replace(/\s+/g, ' ').slice(0, 110));
  ok(/split across 2 jobs/i.test(queue), `${tag} and the split is visible from the list`);

  await page.locator('[data-rrec]').first().click();
  await page.waitForTimeout(700);
  ok(await page.locator('[data-rentered]').count() === 1,
    `${tag} she can mark it entered`);
  await page.locator('[data-rentered]').click();
  await page.waitForTimeout(400);
  const need = (await page.locator('#rqmsg').textContent()) || '';
  ok(/purchase order number/i.test(need),
    `${tag} and it will not be marked entered without the Fullbay PO number`, need.slice(0, 100));

  await page.fill('#r_po', '54278999');
  await page.locator('[data-rentered]').click();
  await page.waitForTimeout(1200);
  const done = await page.locator('#view').innerText();
  ok(/54278999/.test(done), `${tag} the PO number goes on the record`,
    done.replace(/\s+/g, ' ').slice(0, 110));

  // ---- a tech still cannot read any of it -------------------------
  await be('demo-clint');
  const clintNav = (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());
  ok(!clintNav.some(x => /receipt/i.test(x)),
    `${tag} a tech has no way through to receipts at all`, clintNav.join(', '));

  const real = errs.filter(e =>
    !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.googleapis|favicon|script\.google/.test(e));
  ok(real.length === 0, `${tag} no script errors`, real.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
