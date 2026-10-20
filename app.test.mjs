/* The shell in a real browser, signed in as each role in turn.
 *
 * The question every check asks is the one that matters for this slice:
 * does this person see exactly what their role allows, and nothing else?
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { HARD_RULES } from '../roles.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml' };

/* The app ships configured to run beside the Launcher. The second pass serves
   a config.js with that address cleared, which is the state on the day the
   Launcher comes down - the tile and the warning both have to go with it. */
const LEGACY_URL = 'https://bsds-app.github.io/';
let legacyCleared = false;

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (path.basename(file) === 'config.js') {
    // Firebase Auth needs Google's servers, which this sandbox cannot reach,
    // so the shipped key is blanked and these run against demo mode. What is
    // under test is the role logic, which is the same either way.
    body = Buffer.from(String(body).replace(/(\n\s*apiKey: )'[^']*'/, "$1''"));
  }
  if (legacyCleared && path.basename(file) === 'config.js') {
    body = Buffer.from(String(body).replace(
      /url: 'https:\/\/bsds-app\.github\.io\/',\n(\s*)title: 'Old Launcher'/,
      "url: '',\n$1title: 'Old Launcher'"));
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const equipment = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/equipment.json')));
const customers = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/customers.json')));

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

for (const size of [{ width: 390, height: 800 }, { width: 1200, height: 900 }]) {
  const tag = `${size.width}px`;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [], notFound = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('response', r => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

  await page.goto(BASE);
  await page.waitForTimeout(400);

  // --- the sign-in screen ------------------------------------------
  ok(await page.locator('#demobar').isVisible(), `${tag} the preview says it is a preview`);
  ok(await page.locator('.people button').count() === 5,
    `${tag} every demo person is offered`);
  ok(await page.locator('#back').isHidden(), `${tag} nothing to go back to before signing in`);

  const homeTiles = async () =>
    (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());

  const signInAs = async (uid) => {
    await page.evaluate(() => {
      try { sessionStorage.clear(); } catch (e) {}
    });
    await page.reload();
    await page.waitForTimeout(300);
    await page.locator(`[data-demo="${uid}"]`).click();
    await page.waitForTimeout(500);
  };

  // --- technician ---------------------------------------------------
  await signInAs('demo-clint');
  ok((await page.locator('#rolepill').textContent()).trim() === 'Technician',
    `${tag} the badge names the role`);
  let nav = await homeTiles();
  ok(nav.includes('Machines'), `${tag} tech: machines`);
  // the label and its note are two lines, not one run-on sentence
  const twoLines = await page.evaluate(() => {
    const r = document.querySelector('.list .row');
    const a = r.querySelector('.nm').getBoundingClientRect();
    const b = r.querySelector('.sub').getBoundingClientRect();
    return b.top >= a.bottom - 1;
  });
  ok(twoLines, `${tag} a list row puts its note on its own line`);
  ok(nav.includes('Parts books'), `${tag} tech: parts books`);
  ok(!nav.includes('Logs'), `${tag} tech: NO logs`, nav.join(', '));
  ok(!nav.includes('People'), `${tag} tech: NO people`, nav.join(', '));
  const tileTitles = async () =>
    (await page.locator('.tile b').allTextContents()).map(s => s.trim());
  let tiles = await tileTitles();
  ok(tiles.includes('Pre-Op Inspection'), `${tag} tech: pre-op tile`);

  // our own tools open inside the app; other people's sites open in a tab
  const kinds = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.tile').forEach(t => {
      out[t.querySelector('b').textContent.trim()] =
        t.tagName + (t.getAttribute('target') || '');
    });
    return out;
  });
  ok(kinds['Pre-Op Inspection'] === 'BUTTON', `${tag} Pre-Op stays in the app`,
    kinds['Pre-Op Inspection']);
  ok(kinds['JSA'] === 'BUTTON', `${tag} JSA stays in the app`, kinds['JSA']);
  ok(kinds['Fullbay'] === 'A_blank', `${tag} Fullbay opens in its own tab`,
    kinds['Fullbay']);
  ok(await page.evaluate(() =>
    [...document.querySelectorAll('.tile.out .leaves')].length > 0),
    `${tag} a tile that leaves the app says so`);
  ok(tiles.includes('JSA'), `${tag} tech: JSA tile`);
  ok(tiles.includes('Send a Receipt'), `${tag} tech: receipt tile`);
  ok(!tiles.includes('Parts Rebuild Order'),
    `${tag} tech: NO rebuild order tile`, tiles.join(', '));
  ok(!tiles.includes('Command Center'),
    `${tag} tech: NO Command Center tile`, tiles.join(', '));
  ok(tiles.every(t => t !== 'Shop reports'), `${tag} tech: no reports`);
  ok(await page.locator('.note').count() >= 1,
    `${tag} tech: the app says plainly what they will not find`);
  let over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, `${tag} tech home does not scroll sideways`, String(over));

  // the matrix, as the tech sees it
  await page.locator('.list .row[data-go="perms"], .bar [data-go="perms"]').click();
  await page.waitForTimeout(300);
  // HARD_RULES holds five refusals across four capabilities - personnel is
  // refused to both tech and office - so the cells are what to count.
  const locked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    return {
      cells: document.querySelectorAll('td.c.locked').length,
      caps: rows.filter(r => r.querySelector('td.c.locked'))
                .map(r => r.querySelector('td.cap').textContent.trim()),
    };
  });
  // counted off roles.js rather than written down here, so adding a rule
  // there is enough to make this check cover it
  const wantCells = HARD_RULES.length;
  const wantCaps = new Set(HARD_RULES.map(r => r.cap)).size;
  ok(locked.cells === wantCells,
    `${tag} every hard refusal is marked in the matrix`,
    `${locked.cells} of ${wantCells}`);
  ok(locked.caps.length === wantCaps, `${tag} on the right number of capabilities`,
    `${locked.caps.length} of ${wantCaps}`);
  ok(locked.caps.some(l => /master log/i.test(l)), `${tag} the master log is one of them`);
  ok(locked.caps.some(l => /receipt images/i.test(l)), `${tag} receipt images is one of them`);
  ok(locked.caps.some(l => /every JSA/i.test(l)), `${tag} the JSA archive is one of them`);
  ok(locked.caps.some(l => /Personnel/i.test(l)), `${tag} personnel is one of them`);
  ok(locked.caps.some(l => /Command Center/i.test(l)),
    `${tag} the Command Center is one of them`, locked.caps.join(', '));
  await page.locator('#back').click();
  await page.waitForTimeout(250);
  ok((await homeTiles()).includes('Machines'), `${tag} Back returns home`);

  // --- a tool opened inside the app ---------------------------------
  // Pre-Op itself is built into the app now and is a route, not a frame -
  // test/preop.test.mjs covers that. What is under test here is still worth
  // testing: a tool that IS another page on our own site opens inside the
  // app with the bar above it, rather than throwing you into another tab.
  // The old Pre-Op app is exactly that, for as long as it is still up.
  await page.evaluate(() => {
    [...document.querySelectorAll('.tile')]
      .find(t => /Pre-Op \(old app\)/.test(t.textContent)).click();
  });
  await page.waitForTimeout(500);
  const framed = await page.evaluate(() => {
    const f = document.querySelector('.frame iframe');
    const bar = document.querySelector('.top').getBoundingClientRect();
    return f ? { src: f.getAttribute('src'), top: f.getBoundingClientRect().top,
                 barBottom: bar.bottom, bodyFramed: document.body.classList.contains('framed'),
                 backVisible: !document.getElementById('back').hidden } : null;
  });
  ok(framed !== null, `${tag} the tool opens in a frame inside the app`);
  if (framed) {
    ok(/bsds-app\.github\.io\/preop/.test(framed.src),
      `${tag} and it is the real Pre-Op page`, framed.src);
    ok(framed.backVisible, `${tag} Back is there while the tool is open`);
    ok(framed.top >= framed.barBottom - 1,
      `${tag} the app bar stays above the tool`, JSON.stringify(framed));
    ok(framed.bodyFramed, `${tag} the page behind the tool does not scroll`);
  }
  await page.locator('#back').click();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.querySelector('.frame')),
    `${tag} Back closes the tool`);
  ok(await page.evaluate(() => !document.body.classList.contains('framed')),
    `${tag} and lets the page scroll again`);
  ok((await tileTitles()).includes('Pre-Op Inspection'),
    `${tag} landing back on the tiles`);

  // --- machines -----------------------------------------------------
  await page.locator('.list .row[data-go="equipment"], .bar [data-go="equipment"]').click();
  await page.waitForTimeout(400);
  const custRows = await page.locator('[data-cust]').count();
  ok(custRows === customers.length, `${tag} every customer is listed`,
    `${custRows} of ${customers.length}`);
  await page.fill('#q', '70165');
  await page.waitForTimeout(300);
  ok(await page.locator('[data-rig]').count() === 1,
    `${tag} searching a serial finds the one rig`);
  await page.locator('[data-rig]').first().click();
  await page.waitForTimeout(350);
  const spec = await page.locator('.spec').textContent();
  ok(/70165/.test(spec) && /Epiroc/i.test(spec),
    `${tag} the machine page shows what is on the record`, spec.replace(/\s+/g, ' ').slice(0, 90));
  ok(await page.locator('.tile b').first().textContent() === 'Parts book',
    `${tag} 70165 offers its parts book`);

  // a machine with no serial must say so rather than offer a wrong book
  await page.locator('#back').click();
  await page.waitForTimeout(300);
  const blank = equipment.find(e => !e.serial);
  await page.fill('#q', blank.unit);
  await page.waitForTimeout(300);
  await page.locator('[data-rig]').first().click();
  await page.waitForTimeout(350);
  const txt = await page.locator('.note').first().textContent();
  ok(/no serial/i.test(txt), `${tag} a rig with no serial explains why there is no book`,
    txt.replace(/\s+/g, ' ').slice(0, 80));
  ok(await page.locator('.tile').count() === 0,
    `${tag} and offers no book at all`);

  // --- office -------------------------------------------------------
  await signInAs('demo-jaz');
  ok((await page.locator('#rolepill').textContent()).trim() === 'Office',
    `${tag} office badge`);
  nav = await homeTiles();
  tiles = await tileTitles();
  ok(nav.includes('Logs'), `${tag} office: logs`, nav.join(', '));
  ok(!nav.includes('People'), `${tag} office: NO people`, nav.join(', '));
  ok(tiles.includes('Parts Rebuild Order'), `${tag} office: rebuild order tile`);
  ok(!tiles.includes('Command Center'),
    `${tag} office: NO Command Center tile \u2014 Mike and Stew only`, tiles.join(', '));
  await page.locator('.list .row[data-go="perms"], .bar [data-go="perms"]').click();
  await page.waitForTimeout(300);
  const officeHr = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')]
      .find(r => /Personnel/i.test(r.querySelector('td.cap').textContent));
    return [...row.querySelectorAll('td.c')].map(td => td.className);
  });
  ok(/locked/.test(officeHr[1]), `${tag} office is refused personnel in the matrix`,
    String(officeHr));
  ok(/yes/.test(officeHr[2]), `${tag} owner has personnel in the matrix`, String(officeHr));

  // --- owner --------------------------------------------------------
  await signInAs('demo-mike');
  ok((await page.locator('#rolepill').textContent()).trim() === 'Owner',
    `${tag} owner badge`);
  nav = await homeTiles();
  ok(nav.includes('People'), `${tag} owner: people`, nav.join(', '));
  ok(nav.includes('Logs'), `${tag} owner: logs`);
  ok(nav.includes('Machines') && nav.includes('Parts books'), `${tag} owner: everything else`);
  ok((await tileTitles()).includes('Command Center'), `${tag} owner: Command Center`);
  await page.locator('.list .row[data-go="people"], .bar [data-go="people"]').click();
  await page.waitForTimeout(700);
  // People is its own screen now - test/people.test.mjs works it properly.
  // What belongs here is only that an owner reaches it and sees real rows.
  ok(await page.locator('.prow').count() === 5, `${tag} the people list is there`,
    String(await page.locator('.prow').count()));
  ok(await page.locator('#invadd').count() === 1,
    `${tag} and an owner can add somebody from it`);

  // --- signing out --------------------------------------------------
  await page.locator('#signout').click();
  await page.waitForTimeout(350);
  ok(await page.locator('.people button').count() === 5,
    `${tag} signing out returns to the door`);
  ok(await page.locator('#who').isHidden(), `${tag} the role badge goes away`);

  // --- themes --------------------------------------------------------
  await page.locator('[data-demo="demo-mike"]').click();
  await page.waitForTimeout(400);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    const c = await page.evaluate(() => {
      const b = getComputedStyle(document.body), t = getComputedStyle(document.querySelector('.top'));
      return { bg: b.backgroundColor, fg: b.color, tbg: t.backgroundColor, tfg: t.color };
    });
    const lum = s => {
      const m = s.match(/\d+/g).slice(0, 3).map(Number);
      return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
    };
    ok(c.bg !== 'rgba(0, 0, 0, 0)', `${tag} ${scheme}: body paints its own background`, c.bg);
    ok(Math.abs(lum(c.bg) - lum(c.fg)) > 0.4, `${tag} ${scheme}: text reads`, JSON.stringify(c));
    ok(Math.abs(lum(c.tbg) - lum(c.tfg)) > 0.4, `${tag} ${scheme}: the bar reads`, JSON.stringify(c));
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // a missing favicon is the browser asking, not the app failing
  const missed = notFound.filter(p => p !== '/favicon.ico');
  ok(missed.length === 0, `${tag} every file the app asks for is there`, missed.join(', '));
  // --- the old Launcher, side by side -------------------------------
  for (const uid of ['demo-clint', 'demo-jaz', 'demo-mike']) {
    await page.evaluate(() => { try { sessionStorage.clear(); } catch (e) {} });
    await page.reload();
    await page.waitForTimeout(300);
    await page.locator(`[data-demo="${uid}"]`).click();
    await page.waitForTimeout(450);
    const lg = page.locator('.tile.legacy');
    ok(await lg.count() === 1, `${tag} ${uid}: the Launcher is still reachable`);
    // it is on our own site, so it opens inside the app like the rest
    ok(await lg.evaluate(e => e.tagName) === 'BUTTON',
      `${tag} ${uid}: and it opens inside the app`);
    await lg.click();
    await page.waitForTimeout(450);
    const src = await page.evaluate(() =>
      document.querySelector('.frame iframe')?.getAttribute('src'));
    ok(src === LEGACY_URL, `${tag} ${uid}: the frame holds the Launcher`, String(src));
    await page.locator('#back').click();
    await page.waitForTimeout(350);
  }
  await page.locator('.list .row[data-go="perms"], .bar [data-go="perms"]').click();
  await page.waitForTimeout(350);
  const warned = (await page.locator('.note.warn').allTextContents()).join(' ');
  ok(/no sign-in/i.test(warned),
    `${tag} the matrix says the Launcher is still an open door`,
    warned.replace(/\s+/g, ' ').slice(0, 80));
  ok(/Command Center/i.test(warned),
    `${tag} and names the Command Center page as part of it`);

  // and the day it comes down, the tile and the warning go with it
  legacyCleared = true;
  await page.evaluate(() => { try { sessionStorage.clear(); } catch (e) {} });
  await page.goto(BASE + '?retired');
  await page.waitForTimeout(400);
  await page.locator('[data-demo="demo-mike"]').click();
  await page.waitForTimeout(450);
  ok(await page.locator('.tile.legacy').count() === 0,
    `${tag} clearing legacy.url removes the Launcher tile`);
  await page.locator('.list .row[data-go="perms"], .bar [data-go="perms"]').click();
  await page.waitForTimeout(350);
  const after = (await page.locator('.note.warn').allTextContents()).join(' ');
  ok(!/no sign-in/i.test(after),
    `${tag} and removes the open-door warning with it`,
    after.replace(/\s+/g, ' ').slice(0, 70));
  legacyCleared = false;

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
