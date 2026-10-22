/* The Pre-Op form, in a real browser, as each role in turn.
 *
 * Two questions, and the first one is the one this project keeps getting
 * wrong in the same way:
 *
 *   1. Is every line of the checklist actually there? A form that quietly
 *      drops a line looks exactly like a form that works. So the template is
 *      counted, the drawn form is counted, and the saved record is counted,
 *      and all three have to agree for all seven equipment types.
 *
 *   2. Does a record read back as the SHEET, with the retention rules the
 *      regulation actually sets - no expiry while a defect is open, no expiry
 *      under a legal hold, and a date once the defect is signed off?
 *
 * Runs in demo mode, where records go to sessionStorage instead of Firestore.
 * The form, the validation, the rendering and the retention arithmetic are
 * the same code either way; what demo mode cannot test is who the DATABASE
 * hands records to, which is test/rules.test.mjs against the emulator.
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

const TPL = JSON.parse(fs.readFileSync(path.join(ROOT, 'forms/preop.v1.json'), 'utf8'));
const RETENTION_DAYS = 395;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

/* ---------- the template, before a browser is involved ---------------- */

const linesOf = (key, freq) => {
  const t = TPL.types[key];
  const s = t.sections || (t.byFrequency ? t.byFrequency[freq || 'daily'] : null);
  return s ? Object.values(s).reduce((a, v) => a + v.length, 0) : 0;
};

ok(TPL.version === 1, 'the template declares its version');
ok(TPL.typeOrder.length === 7, 'seven equipment types', String(TPL.typeOrder.length));
ok(TPL.typeOrder.every(k => TPL.types[k]), 'every type in the order exists');
ok(Object.keys(TPL.types).every(k => TPL.typeOrder.includes(k)),
  'every type that exists is in the order - none orphaned');
ok(TPL.resultChoices.map(c => c.value).join(',') === 'pass,fail,na',
  'the three buttons are the three the old app had');
ok(TPL.frequencies.length === 2, 'daily and annual');

const TOTAL = TPL.typeOrder.reduce((a, k) => {
  const t = TPL.types[k];
  return a + (t.sections ? linesOf(k)
    : Object.keys(t.byFrequency).reduce((b, f) => b + linesOf(k, f), 0));
}, 0);
ok(TOTAL === 179, 'all 179 checklist lines are in the template', String(TOTAL));

TPL.typeOrder.forEach(k => {
  const t = TPL.types[k];
  ok(!!t.label && !!t.meterLabel, `${k} has a label and a meter label`);
  const buckets = t.sections ? [t.sections] : Object.values(t.byFrequency);
  buckets.forEach(b => {
    ok(Object.keys(b).length > 0, `${k} has sections`);
    Object.entries(b).forEach(([s, items]) => {
      ok(items.length > 0, `${k} / ${s} is not empty`);
      ok(items.every(x => typeof x === 'string' && x.trim()), `${k} / ${s} has no blank line`);
      ok(new Set(items).size === items.length, `${k} / ${s} has no repeated line`);
    });
  });
});

/* every field the form draws is a field collect() knows how to read */
const KEYS = ['eqType', 'inspFrequency', 'eqUnit', 'operatorName', 'inspDate',
              'siteName', 'meterReading', 'overallNotes', 'signName'];
const declared = [...TPL.header, ...TPL.footer].map(f => f.key);
ok(declared.every(k => KEYS.includes(k)), 'the template asks for no field the form cannot read',
  declared.filter(k => !KEYS.includes(k)).join(', '));

/* ---------- in the browser -------------------------------------------- */

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

  /* Signs in without wiping sessionStorage - the demo record store lives
     there, and the point of several of these checks is that a record filed
     by one person is still there when somebody else signs in. */
  const be = async (uid) => {
    await page.evaluate(u => { sessionStorage.setItem('bsds.demoUser', u); }, uid);
    await page.reload();
    await page.waitForTimeout(450);
  };
  const openForm = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll('.tile')]
        .find(t => t.textContent.trim().startsWith('Pre-Op Inspection')).click();
    });
    await page.waitForTimeout(500);
  };
  /* Back out of wherever we are until the tiles are showing. Filing a sheet
     lands on the record, which is one level deeper than the form, so "go
     home" is not one click and should not be written as if it were. */
  const goHome = async () => {
    for (let i = 0; i < 6; i++) {
      if (await page.locator('.tile b').count() > 0) return;
      if (await page.locator('#back').isHidden()) return;
      await page.locator('#back').click();
      await page.waitForTimeout(320);
    }
  };
  const pick = async (key, freq) => {
    await page.selectOption('[data-f="eqType"]', key);
    await page.waitForTimeout(200);
    if (freq) {
      await page.selectOption('[data-f="inspFrequency"]', freq);
      await page.waitForTimeout(200);
    }
  };
  const markAll = async (what) => {
    await page.evaluate(w => {
      document.querySelectorAll('.item').forEach(it => {
        it.querySelector('.res[data-result="' + w + '"]').click();
      });
    }, what);
    await page.waitForTimeout(150);
  };

  // ---- a tech gets the form, and his own sheets, and nothing else ----
  await be('demo-clint');
  const navRows = async () =>
    (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());
  let nav = await navRows();
  ok(nav.includes('My inspections'), `${tag} tech: his own inspections`, nav.join(', '));
  ok(!nav.includes('Logs'), `${tag} tech: still NO master log`, nav.join(', '));
  const tiles = (await page.locator('.tile b').allTextContents()).map(s => s.trim());
  ok(tiles.includes('Pre-Op Inspection'), `${tag} the built-in form is on the tiles`);
  ok(tiles.includes('Pre-Op (old app)'),
    `${tag} the old app is still reachable during the changeover`);

  await openForm();
  ok(await page.locator('#pform').count() === 1, `${tag} the form draws`);
  ok(await page.evaluate(() => !document.querySelector('.frame')),
    `${tag} and it is the app, not an iframe of another page`);
  ok(await page.inputValue('[data-f="operatorName"]') === 'Clint',
    `${tag} the operator is filled in already`);
  ok(await page.inputValue('[data-f="signName"]') === 'Clint',
    `${tag} so is the signature line`);
  ok((await page.inputValue('[data-f="inspDate"]')).length === 16,
    `${tag} and the date and time`);
  ok(await page.locator('.fq').isHidden(),
    `${tag} no frequency question before a type is chosen`);
  ok(await page.locator('#unitlist option').count() === 77,
    `${tag} all 77 Fullbay machines are offered as units`);

  // ---- every type draws exactly its own lines ----------------------
  for (const key of TPL.typeOrder) {
    const isFP = !!TPL.types[key].byFrequency;
    await pick(key, isFP ? 'daily' : null);
    const drawn = await page.locator('.item').count();
    ok(drawn === linesOf(key, 'daily'),
      `${tag} ${key}: ${linesOf(key, 'daily')} lines drawn`, String(drawn));
    ok(await page.locator('.fq').isHidden() === !isFP,
      `${tag} ${key}: the frequency question appears only where it matters`);
    const meter = (await page.locator('[data-meter]').textContent()).trim();
    ok(meter === TPL.types[key].meterLabel,
      `${tag} ${key}: the meter is labelled ${TPL.types[key].meterLabel}`, meter);
    if (isFP) {
      await pick(key, 'annual');
      const n2 = await page.locator('.item').count();
      ok(n2 === linesOf(key, 'annual'),
        `${tag} ${key}: the annual checklist is its own ${linesOf(key, 'annual')} lines`,
        String(n2));
    }
  }

  // ---- it will not file a partial sheet ----------------------------
  await pick('rig');
  await page.locator('#psubmit').click();
  await page.waitForTimeout(250);
  let msg = await page.locator('#pmsg').textContent();
  ok(/26 lines not marked/.test(msg), `${tag} an unmarked sheet is refused by count`, msg);
  ok(await page.locator('.sheet').count() === 0, `${tag} and nothing was filed`);

  await markAll('pass');
  ok(/26 of 26 lines marked/.test(await page.locator('#tally').textContent()),
    `${tag} the tally says when it is complete`);
  // ---- a clean sheet files, and reads back as the sheet -------------
  /* Nothing more is typed here on purpose: operator, signature and date were
     filled in when the form drew, so a complete sheet is a type, 26 taps and
     Submit. If a prefilled field were being asked for again this submit
     would be refused instead of filing. */
  await page.locator('#psubmit').click();
  await page.waitForTimeout(800);
  ok(await page.locator('.sheet').count() === 1, `${tag} a clean sheet files`);
  ok((await page.locator('.stamp').textContent()).trim() === 'PASS',
    `${tag} and comes back stamped PASS`);
  const lines = await page.locator('.sline').count();
  ok(lines === 26, `${tag} the record carries all 26 lines, not a summary`, String(lines));
  ok(await page.locator('.sline .sres').first().textContent() === 'Pass',
    `${tag} each line shows how it was marked`);
  ok(await page.locator('.sgrid').count() === 1,
    `${tag} the header block is on the record`);
  ok(/Pre-Op v1/.test(await page.locator('.ssign').textContent()),
    `${tag} the record says which version of the form it was signed on`);
  const ret = await page.locator('.note').first().textContent();
  ok(/Scheduled to drop off/.test(ret), `${tag} a clean sheet gets a retention date`, ret);
  /* 13 months, read off the screen rather than off the constant */
  const shown = new Date(ret.replace(/^[\s\S]*drop off /, '').replace(/\.\s*$/, ''));
  const days = Math.round((shown - new Date()) / 86400000);
  ok(Math.abs(days - RETENTION_DAYS) <= 2,
    `${tag} and the date is 13 months out`, `${days} days`);
  ok(await page.locator('[data-hold]').count() === 0,
    `${tag} a tech cannot put a legal hold on anything`);
  ok(await page.locator('[data-fix]').count() === 0,
    `${tag} a tech cannot sign off a defect`);

  // ---- a fail needs a note, and holds the record open --------------
  await goHome();
  await openForm();
  await pick('pickup');
  await markAll('pass');
  await page.evaluate(() => {
    document.querySelector('.item[data-item="7"] .res[data-result="fail"]').click();
  });
  await page.waitForTimeout(150);
  ok(await page.locator('.item[data-item="7"] textarea').isVisible(),
    `${tag} marking a line Fail asks why`);
  await page.locator('#psubmit').click();
  await page.waitForTimeout(250);
  msg = await page.locator('#pmsg').textContent();
  ok(/A failed line needs a note/.test(msg), `${tag} a fail with no note is refused`, msg);
  await page.fill('.item[data-item="7"] textarea', 'Left rear brake light out');
  await page.locator('#psubmit').click();
  await page.waitForTimeout(700);
  ok((await page.locator('.stamp').textContent()).trim() === 'FAIL',
    `${tag} a sheet with a fail comes back stamped FAIL`);
  const ret2 = await page.locator('.note').first().textContent();
  ok(/uncorrected defect/.test(ret2) && /56\.14100/.test(ret2),
    `${tag} an open defect has NO expiry, and the record says which rule says so`, ret2);
  ok(/Left rear brake light out/.test(await page.locator('.sitem').allTextContents()
      .then(a => a.join(' '))),
    `${tag} the note is on the line it belongs to`);

  // ---- a tech sees his own, and only his own -----------------------
  await goHome();
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My inspections/.test(r.textContent)).click();
  });
  await page.waitForTimeout(450);
  ok(await page.locator('[data-preop]').count() === 2,
    `${tag} Clint sees the two sheets he filed`);
  ok(await page.locator('.spec').count() === 0,
    `${tag} and not the shop-wide tallies`);

  await be('demo-noah');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My inspections/.test(r.textContent)).click();
  });
  await page.waitForTimeout(450);
  ok(await page.locator('[data-preop]').count() === 0,
    `${tag} another tech sees none of Clint's sheets`);

  // ---- office: the master log, corrections, but no hold ------------
  await be('demo-jaz');
  nav = await navRows();
  ok(nav.includes('Logs'), `${tag} office: the logs`);
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')].find(r => /Logs/.test(r.textContent)).click();
  });
  await page.waitForTimeout(350);
  await page.locator('.list .row[data-go="preoplog"], .bar [data-go="preoplog"]').click();
  await page.waitForTimeout(450);
  ok(await page.locator('[data-preop]').count() === 2,
    `${tag} office sees both sheets`);
  const spec = await page.locator('.spec').textContent();
  ok(/1[\s\S]*defects open/.test(spec), `${tag} the log counts what is still open`, spec);

  await page.evaluate(() => {
    [...document.querySelectorAll('[data-preop]')]
      .find(b => /fail/.test(b.textContent)).click();
  });
  await page.waitForTimeout(500);
  ok(await page.locator('[data-fix]').count() === 1,
    `${tag} office can sign the defect off`);
  ok(await page.locator('[data-hold]').count() === 0,
    `${tag} office cannot put a legal hold on it`);
  await page.locator('[data-fix]').click();
  await page.waitForTimeout(600);
  const ret3 = await page.locator('.note').first().textContent();
  ok(/Scheduled to drop off/.test(ret3),
    `${tag} signing off the last defect starts the clock`, ret3);
  ok(/Corrected/.test(await page.locator('.sitem').allTextContents().then(a => a.join(' '))),
    `${tag} and the correction is written on the line, not instead of it`);

  // ---- owner: the legal hold ---------------------------------------
  await be('demo-mike');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')].find(r => /Logs/.test(r.textContent)).click();
  });
  await page.waitForTimeout(350);
  await page.locator('.list .row[data-go="preoplog"], .bar [data-go="preoplog"]').click();
  await page.waitForTimeout(450);
  await page.locator('[data-preop]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-hold="on"]').count() === 1,
    `${tag} an owner can put a hold on a record`);
  await page.fill('#holdwhy', 'Kennecott incident 10/21');
  await page.locator('[data-hold="on"]').click();
  await page.waitForTimeout(700);
  const held = await page.locator('.note').first().textContent();
  ok(/On legal hold/.test(held) && /Kennecott incident/.test(held),
    `${tag} a held record will not be deleted, and says why`, held);
  ok(!/Scheduled to drop off/.test(held),
    `${tag} and has no expiry date at all while the hold is on`, held);
  const nulled = await page.evaluate(() => {
    const rows = JSON.parse(sessionStorage.getItem('bsds.preops') || '[]');
    const h = rows.find(r => r.hold);
    return h ? h.expiresAt : 'no held record';
  });
  ok(nulled === null,
    `${tag} the stored expiry really is empty - the purge has nothing to read`,
    String(nulled));
  await page.locator('[data-hold="off"]').click();
  await page.waitForTimeout(700);
  ok(/Scheduled to drop off/.test(await page.locator('.note').first().textContent()),
    `${tag} releasing the hold puts the date back`);

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
