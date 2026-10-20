/* The People screen, in a real browser.
 *
 * This is the screen that decides who can see what, so the questions are
 * blunt:
 *
 *   - Can an owner add, move and switch off anybody?
 *   - Can an owner lock themselves out? (must be no)
 *   - Can anybody who is not an owner reach it at all? (must be no)
 *
 * The second one is the reason this file exists. Everything else on this
 * screen is recoverable by clicking again. An owner who demotes or switches
 * off their own account is a support call that ends in somebody opening the
 * Firebase console, which is exactly what this screen was built to avoid.
 *
 * Demo mode, so the people live in sessionStorage. Whether the DATABASE
 * refuses the same things is test/rules.test.mjs against the emulator, and
 * the shapes of those rules are checked by test/rules.static.mjs.
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
    await page.evaluate(u => {
      sessionStorage.setItem('bsds.demoUser', u);
      sessionStorage.removeItem('bsds.people');
      sessionStorage.removeItem('bsds.invites');
    }, uid);
    await page.reload();
    await page.waitForTimeout(500);
  };
  const openPeople = async () => {
    await page.locator('.list .row[data-go="people"], .bar [data-go="people"]').click();
    await page.waitForTimeout(700);
  };
  const rowFor = (name) =>
    page.locator('.prow').filter({ hasText: name }).first();

  // ---- the sign-in screen offers a first-time path ------------------
  await page.evaluate(() => sessionStorage.removeItem('bsds.demoUser'));
  await page.reload();
  await page.waitForTimeout(450);
  ok(await page.locator('.people button').count() === 5,
    `${tag} the preview still offers every demo person`);

  // ---- a tech cannot reach it --------------------------------------
  await be('demo-clint');
  ok(await page.locator('.list .row[data-go="people"], .bar [data-go="people"]').count() === 0,
    `${tag} a tech has no way to People`);
  await page.evaluate(() => {
    history.pushState({}, '', location.pathname);
    document.body.insertAdjacentHTML('beforeend',
      '<button id="sneak" data-go="people">x</button>');
    document.getElementById('sneak').click();
  });
  await page.waitForTimeout(600);
  ok(/Not your account to change/.test(await page.locator('#view').innerText()),
    `${tag} and reaching it another way is refused in words`,
    (await page.locator('#view').innerText()).slice(0, 60));

  // ---- office cannot either ----------------------------------------
  await be('demo-jaz');
  ok(await page.locator('.list .row[data-go="people"], .bar [data-go="people"]').count() === 0,
    `${tag} office has no way to People either`);

  // ---- the owner's own row is the one they cannot touch ------------
  await be('demo-mike');
  await openPeople();
  ok(await page.locator('.prow').count() === 5, `${tag} all five are listed`,
    String(await page.locator('.prow').count()));
  const mine = rowFor('Mike Clunas');
  ok(await mine.locator('em').first().textContent() === 'you',
    `${tag} your own row is marked`);
  ok(await mine.locator('select').count() === 0,
    `${tag} THE ONE THAT MATTERS: no role dropdown on your own row`);
  ok(await mine.locator('[data-active]').count() === 0,
    `${tag} and no way to switch yourself off`);
  ok(await rowFor('Clint').locator('select').count() === 1,
    `${tag} but you can change somebody else's role`);

  // ---- moving somebody -------------------------------------------
  await rowFor('Clint').locator('select').selectOption('office');
  await page.waitForTimeout(800);
  ok(await rowFor('Clint').locator('select').inputValue() === 'office',
    `${tag} a role change sticks`);
  await rowFor('Clint').locator('select').selectOption('tech');
  await page.waitForTimeout(800);

  // ---- switching somebody off ------------------------------------
  await rowFor('Noah').locator('[data-active]').click();
  await page.waitForTimeout(800);
  const offSection = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2.sec')].find(x => /Switched off/.test(x.textContent));
    return h ? h.nextElementSibling.innerText : '';
  });
  ok(/Noah/.test(offSection), `${tag} switching somebody off moves them`, offSection.slice(0, 50));
  ok(await rowFor('Noah').evaluate(e => e.classList.contains('off')),
    `${tag} and the row reads as switched off`);
  ok(/Switch back on/.test(await rowFor('Noah').locator('[data-active]').textContent()),
    `${tag} and it can be undone`);
  await rowFor('Noah').locator('[data-active]').click();
  await page.waitForTimeout(800);
  ok(await rowFor('Noah').evaluate(e => !e.classList.contains('off')),
    `${tag} switching them back on works`);

  // ---- inviting --------------------------------------------------
  await page.fill('#inv_name', '');
  await page.fill('#inv_email', 'someone@example.com');
  await page.locator('#invadd').click();
  await page.waitForTimeout(400);
  ok(/Put a name on it/.test(await page.locator('#invmsg').textContent()),
    `${tag} an invitation needs a name`);
  await page.fill('#inv_name', 'Dale');
  await page.fill('#inv_email', 'not-an-email');
  await page.locator('#invadd').click();
  await page.waitForTimeout(400);
  ok(/does not look like an email/.test(await page.locator('#invmsg').textContent()),
    `${tag} and a real address`);
  ok(await page.locator('[data-invite]').count() === 0, `${tag} neither was saved`);

  await page.fill('#inv_name', 'Dale');
  await page.fill('#inv_email', '  Dale@BSDS.Local ');
  await page.selectOption('#inv_role', 'tech');
  await page.locator('#invadd').click();
  await page.waitForTimeout(900);
  ok(await page.locator('[data-invite]').count() === 1, `${tag} a good invitation is saved`);
  const inv = page.locator('.prow.pending').first();
  ok(/dale@bsds\.local/.test(await inv.innerText()),
    `${tag} and the address is tidied to lower case`, await inv.innerText());
  // the badge is uppercased by CSS, and innerText reports what is rendered
  ok(/waiting/i.test(await inv.innerText()), `${tag} and marked as not signed in yet`,
    (await inv.innerText()).replace(/\n/g, ' | '));
  ok(/Dale is invited/.test(await page.locator('#invmsg').textContent()),
    `${tag} and it says so plainly`);
  ok(await page.locator('.prow').count() === 6,
    `${tag} the invitation is listed without being a real account yet`);

  await page.locator('[data-cancel]').click();
  await page.waitForTimeout(800);
  ok(await page.locator('[data-invite]').count() === 0, `${tag} an invitation can be cancelled`);

  /* The sandbox cannot reach Google Fonts; that is the harness, not the app. */
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
