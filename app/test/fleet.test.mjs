/* Machines and customers, in a real browser.
 *
 * The question this file exists to answer: CAN TWO MACHINES END UP WITH THE
 * SAME SERIAL NUMBER?
 *
 * The parts books are laid out by serial. A duplicate does not look like a
 * bug - it looks like a rig that opens a parts book, except it is the wrong
 * rig's book, and a tech orders off it or works off its hydraulic schematic.
 * So most of what follows is trying to get a duplicate past the form,
 * including by typing the same serial with punctuation in it.
 *
 * The rest: that the 14 machines with no serial are visible as a worklist
 * rather than buried, that retiring keeps a machine on file, that renaming a
 * customer carries through to their machines, and that Jazmine can keep
 * customer records without being able to restructure the fleet.
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

const EQ = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/equipment.json')));
const CU = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/customers.json')));
const BLANK = EQ.filter(e => !e.serial).length;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

ok(BLANK === 14, 'the export really does have 14 machines with no serial', String(BLANK));

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
    await page.evaluate(u => {
      sessionStorage.clear();
      sessionStorage.setItem('bsds.demoUser', u);
    }, uid);
    await page.reload();
    await page.waitForTimeout(700);
  };
  /* Get to the fleet screen from wherever we are. Filing something lands
     you on the thing you just filed, not back where you started, so this
     backs out first and no-ops if we are already there. */
  const toMachines = async () => {
    if (await page.locator('#q').count()) return;
    for (let i = 0; i < 6; i++) {
      if (await page.locator('.list .row[data-go="equipment"], .bar [data-go="equipment"]').count()) break;
      if (await page.locator('#back').isHidden()) break;
      await page.locator('#back').click();
      await page.waitForTimeout(350);
    }
    await page.locator('.list .row[data-go="equipment"], .bar [data-go="equipment"]').click();
    await page.waitForTimeout(600);
  };
  const setM = async (k, v) => {
    await page.evaluate(([a, b]) => {
      const el = document.querySelector('[data-m="' + a + '"]');
      el.value = b;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [k, v]);
    await page.waitForTimeout(80);
  };
  const mmsg = async () => (await page.locator('#mmsg').count())
    ? ((await page.locator('#mmsg').textContent()) || '') : '';

  // ---- owner: the fleet screen ------------------------------------
  await be('demo-mike');
  await toMachines();
  ok(await page.locator('.list .row[data-go="editrig"], .bar [data-go="editrig"]').count() === 1,
    `${tag} an owner can add a machine`);
  ok(await page.locator('.list .row[data-go="editcust"], .bar [data-go="editcust"]').count() === 1,
    `${tag} and a customer`);
  const warn = await page.locator('.note.warn').first().innerText();
  ok(new RegExp(BLANK + ' machines with no serial').test(warn),
    `${tag} the blank serials are counted on the front of the screen`,
    warn.replace(/\s+/g, ' ').slice(0, 70));
  await page.locator('#shownoserial').click();
  await page.waitForTimeout(400);
  ok(await page.locator('[data-rig]').count() === BLANK,
    `${tag} and listing them gives exactly those ${BLANK}`,
    String(await page.locator('[data-rig]').count()));

  // ---- adding a machine: what it refuses --------------------------
  await page.locator('.list .row[data-go="editrig"], .bar [data-go="editrig"]').click();
  await page.waitForTimeout(600);
  ok(await page.locator('#mform').count() === 1, `${tag} the machine form draws`);
  await page.locator('#msave').click();
  await page.waitForTimeout(300);
  let m = await mmsg();
  ok(/unit number/i.test(m) && /whose machine/i.test(m),
    `${tag} it will not file a machine with no unit and no customer`, m);

  await setM('customer', 'fisher-industries');
  await setM('unit', 'TEST-1');

  // THE ONE THAT MATTERS - a serial already on another rig
  await setM('serial', '9453');
  await page.locator('#msave').click();
  await page.waitForTimeout(300);
  m = await mmsg();
  ok(/already on 9453/.test(m), `${tag} a duplicate serial is refused`, m.slice(0, 120));
  ok(/parts books are laid out by serial/.test(m),
    `${tag} and it says why, not just "invalid"`);

  // the same serial dressed up with punctuation must not get through
  await setM('serial', '9-4-5 3');
  await page.locator('#msave').click();
  await page.waitForTimeout(300);
  m = await mmsg();
  ok(/already on 9453/.test(m),
    `${tag} and punctuation does not sneak the same serial past it`, m.slice(0, 90));

  await setM('serial', 'XX');
  await page.locator('#msave').click();
  await page.waitForTimeout(300);
  ok(/too short to be real/.test(await mmsg()), `${tag} a two-character serial is refused`);

  await setM('serial', 'TST-99001');
  await setM('year', '1899');
  await page.locator('#msave').click();
  await page.waitForTimeout(300);
  ok(/Year should be between/.test(await mmsg()), `${tag} a nonsense year is refused`);

  // ---- and what it accepts ---------------------------------------
  await setM('year', '2026');
  await setM('make', 'Epiroc');
  await setM('modelOnly', 'D65');
  await setM('meter', '12');
  await setM('nickname', 'The loaner');
  await page.locator('#msave').click();
  await page.waitForTimeout(1200);
  const spec = await page.locator('.spec').innerText();
  ok(await page.locator('.spec').count() === 1, `${tag} a good machine files`,
    (await mmsg()).slice(0, 110));
  ok(/TST-99001/.test(spec), `${tag} with its serial`, spec.replace(/\s+/g, ' ').slice(0, 80));
  ok(/Epiroc/.test(spec) && /D65/.test(spec), `${tag} and its make and model`);
  ok(/Fisher Industries/.test(await page.locator('#view').innerText()),
    `${tag} filed under the right customer`);
  // page headings are uppercased by CSS, and innerText reports what renders
  ok(/the loaner/i.test(await page.locator('h1.pg').innerText()),
    `${tag} and the nickname the crew uses`,
    await page.locator('h1.pg').innerText());

  // ---- a machine with a serial is off the worklist ---------------
  await page.locator('#back').click();
  await page.waitForTimeout(500);
  await toMachines();
  const warn2 = await page.locator('.note.warn').first().innerText();
  ok(new RegExp(BLANK + ' machines with no serial').test(warn2),
    `${tag} the worklist is unchanged - the new one came with a serial`,
    warn2.replace(/\s+/g, ' ').slice(0, 60));

  // ---- retiring -------------------------------------------------
  await page.fill('#q', 'TST-99001');
  await page.waitForTimeout(400);
  ok(await page.locator('[data-rig]').count() === 1, `${tag} it is findable by serial`);
  await page.locator('[data-rig]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-editrig]').click();
  await page.waitForTimeout(600);
  await page.locator('#mretire').click();
  await page.waitForTimeout(1200);
  ok(/Retired/.test(await page.locator('#view').innerText()),
    `${tag} retiring a machine says so on its page`);
  await page.locator('[data-editrig]').click();
  await page.waitForTimeout(600);
  ok(/Put it back in the fleet/.test(await page.locator('#mretire').textContent()),
    `${tag} and it can be put back`);

  // ---- customers -------------------------------------------------
  await be('demo-mike');
  await toMachines();
  ok(await page.locator('[data-cust]').count() === CU.length,
    `${tag} every customer is listed`);
  await page.locator('.list .row[data-go="editcust"], .bar [data-go="editcust"]').click();
  await page.waitForTimeout(600);
  await page.locator('#csave').click();
  await page.waitForTimeout(300);
  ok(/Give the customer a name/.test(await page.locator('#cmsg').textContent()),
    `${tag} a customer needs a name`);
  await setM('name', 'Test Pit LLC');
  await page.locator('#csave').click();
  await page.waitForTimeout(1200);
  ok(/test pit llc/i.test(await page.locator('h1.pg').innerText()),
    `${tag} a new customer is added and opened`,
    await page.locator('h1.pg').innerText());
  ok(/0 machines on file/.test(await page.locator('p.lede').innerText()),
    `${tag} with nothing on their account yet`);

  // renaming carries through to the machines
  await be('demo-mike');
  await toMachines();
  await page.evaluate(() => {
    [...document.querySelectorAll('[data-cust]')]
      .find(b => /Fisher Industries/.test(b.textContent)).click();
  });
  await page.waitForTimeout(600);
  await page.locator('[data-editcust]').click();
  await page.waitForTimeout(600);
  ok(/machines on this account/.test(await page.locator('.note').first().innerText()),
    `${tag} renaming warns that it carries through`);
  await setM('name', 'Fisher Industries Inc');
  await page.locator('#csave').click();
  await page.waitForTimeout(1400);
  await toMachines();
  await page.fill('#q', 'Fisher Industries Inc');
  await page.waitForTimeout(500);
  ok(await page.locator('[data-rig]').count() > 0,
    `${tag} the machines carry the new customer name`,
    String(await page.locator('[data-rig]').count()));

  // ---- office keeps customers, not the fleet ---------------------
  await be('demo-jaz');
  await toMachines();
  ok(await page.locator('.list .row[data-go="editcust"], .bar [data-go="editcust"]').count() === 1,
    `${tag} office can add a customer`);
  ok(await page.locator('.list .row[data-go="editrig"], .bar [data-go="editrig"]').count() === 0,
    `${tag} office cannot add a machine`);
  await page.locator('[data-cust]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-editcust]').count() === 1,
    `${tag} office can edit a customer`);
  ok(await page.locator('[data-newrigfor]').count() === 0,
    `${tag} but not add machines to them`);
  await page.locator('[data-rig]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-editrig]').count() === 0,
    `${tag} and cannot edit a machine`);

  // ---- a tech changes nothing ------------------------------------
  await be('demo-clint');
  await toMachines();
  ok(await page.locator('.list .row[data-go="editrig"], .bar [data-go="editrig"]').count() === 0
    && await page.locator('.list .row[data-go="editcust"], .bar [data-go="editcust"]').count() === 0,
    `${tag} a tech cannot add anything`);
  await page.locator('[data-cust]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-editcust]').count() === 0,
    `${tag} nor edit a customer`);
  await page.locator('[data-rig]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-editrig]').count() === 0,
    `${tag} nor a machine - but he can still look one up`);
  ok(await page.locator('.spec').count() === 1,
    `${tag} which is the whole point of him having it`);

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
