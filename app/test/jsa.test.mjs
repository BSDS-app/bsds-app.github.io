/* The JSA, in a real browser, as each role in turn.
 *
 * The pre-op suite asks "is every line there". This one asks that too, but
 * its real question is different: DOES THE FORM REFUSE TO LET SOMEBODY SIGN
 * A PERMIT THEY HAVE NOT FILLED IN?
 *
 * Twelve MSHA hazard categories. Three of them - hot work, heights, confined
 * space - open a permit when answered YES. A confined-space entry signed off
 * with no oxygen reading, no attendant and no rescue plan is the piece of
 * paper that gets read out at an inquest, so most of what follows is checking
 * that the form will not file one.
 *
 * Demo mode: records go to sessionStorage rather than Firestore. The form,
 * the validation, the rendering and the retention arithmetic are the same
 * code either way. What demo mode cannot test is who the DATABASE hands
 * records to - that is test/rules.test.mjs against the emulator.
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

const TPL = JSON.parse(fs.readFileSync(path.join(ROOT, 'forms/jsa.v1.json'), 'utf8'));
const RETENTION_DAYS = 395;

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

/* ---------- the template, before a browser is involved ---------------- */

ok(TPL.version === 1, 'the template declares its version');
ok(TPL.hazards.length === 12, 'twelve MSHA hazard categories', String(TPL.hazards.length));
const trig = TPL.hazards.filter(h => h.permit);
ok(trig.length === 3, 'three of them open a permit', trig.map(h => h.key).join(','));
ok(TPL.ppe.length === 11, 'eleven PPE lines', String(TPL.ppe.length));
ok(TPL.loto.sources.length === 5, 'five energy sources');
ok(TPL.header.length === 6, 'six job-detail fields');
ok(TPL.signoff.length === 3, 'three sign-off fields');
ok(TPL.steps.columns.length === 3, 'a job step is work, hazard and control');
ok(TPL.permits.hotwork.fields.length === 10, 'hot work permit has its ten lines');
ok(TPL.permits.heights.fields.length === 14, 'heights permit has its fourteen lines');
ok(TPL.permits.confined.fields.length === 13, 'confined space permit has its thirteen lines');
ok(TPL.permits.heights.fields.filter(f => f.group === 'Harness Inspection').length === 6,
  'the harness inspection is six items');
ok(TPL.statusChoices.map(c => c.value).join(',') === 'no,yes,na',
  'the three buttons are the ones the old app had');

/* every permit a hazard names exists, and no permit is unreachable */
const named = new Set(trig.map(h => h.permit));
ok([...named].every(p => TPL.permits[p]), 'every triggered permit exists');
ok(Object.keys(TPL.permits).every(p => named.has(p)),
  'no permit exists that nothing can open');

/* a duplicated key silently loses an answer */
const keys = [...TPL.header, ...TPL.loto.fields, ...TPL.signoff, TPL.reflection,
  ...Object.values(TPL.permits).flatMap(p => p.fields)].map(f => f.key);
ok(new Set(keys).size === keys.length, 'no field key is used twice',
  keys.filter((k, i) => keys.indexOf(k) !== i).join(','));

/* the atmospheric readings are the ones that must not be skippable */
const cs = TPL.permits.confined.fields;
['csOxygen', 'csLEL', 'csCO', 'csH2S', 'csAttendant', 'csRescueReady', 'csSupervisor']
  .forEach(k => {
    const f = cs.find(x => x.key === k);
    ok(f && f.req === true, `confined space: ${k} is required, not optional`);
  });
ok(TPL.permits.heights.fields.find(f => f.key === 'hpRescuePlanText').req === true,
  'heights: the rescue plan is required');
ok(TPL.permits.hotwork.fields.find(f => f.key === 'hwFireWatchName').req === true,
  'hot work: the fire watch has to be named');

/* ---------- in the browser -------------------------------------------- */

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
    await page.waitForTimeout(450);
  };
  const goHome = async () => {
    for (let i = 0; i < 6; i++) {
      if (await page.locator('.tile b').count() > 0) return;
      if (await page.locator('#back').isHidden()) return;
      await page.locator('#back').click();
      await page.waitForTimeout(320);
    }
  };
  const openForm = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll('.tile')]
        .find(t => t.querySelector('b') && t.querySelector('b').textContent.trim() === 'JSA')
        .click();
    });
    await page.waitForTimeout(600);
  };
  const mark = async (key, val) => {
    await page.evaluate(([k, v]) => {
      document.querySelector('[data-haz="' + k + '"] .res[data-result="' + v + '"]').click();
    }, [key, val]);
    await page.waitForTimeout(90);
  };
  const markAll = async (val) => {
    for (const h of TPL.hazards) await mark(h.key, val);
  };
  const setJ = async (key, value) => {
    await page.evaluate(([k, v]) => {
      const e = document.querySelector('[data-j="' + k + '"]');
      if (e.type === 'checkbox') { e.checked = !!v; }
      else { e.value = v; }
      e.dispatchEvent(new Event('change', { bubbles: true }));
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, [key, value]);
    await page.waitForTimeout(60);
  };
  const controls = async (key, text) => {
    await page.evaluate(([k, t]) => {
      document.querySelector('[data-haz="' + k + '"] textarea').value = t;
    }, [key, text]);
  };
  const step = async (n, d, hz, c) => {
    await page.evaluate(([n2, d2, h2, c2]) => {
      const r = document.querySelector('.steprow[data-step="' + n2 + '"]');
      r.querySelector('[data-col="desc"]').value = d2;
      r.querySelector('[data-col="haz"]').value = h2;
      r.querySelector('[data-col="ctl"]').value = c2;
    }, [String(n), d, hz, c]);
  };
  /* everything a JSA needs that is not the hazard review */
  const fillTheRest = async () => {
    await setJ('jsaSite', 'Kennecott APEX');
    await setJ('jsaEquipment', '70165');
    await setJ('jsaTaskDesc', 'Replace rotary head seal kit');
    await setJ('jsaCrew', 'Clint, Noah');
    await step(1, 'Tram rig to level pad', 'Ground conditions, traffic',
      'Spot man, chock tracks');
    await setJ('mostDangerousTask', 'Tramming on the slope to the pad');
    await setJ('crewAckCheck', true);
  };
  /* The message box only exists while the form is on screen - once a JSA
     files we are on the record. Returning '' rather than hanging matters
     because this is also passed as the detail on assertions that PASS. */
  const msg = async () => (await page.locator('#jmsg').count())
    ? ((await page.locator('#jmsg').textContent()) || '') : '';

  // ---- a tech gets the JSA and his own JSAs ------------------------
  await be('demo-clint');
  const nav = (await page.locator('.list .row .nm').allTextContents()).map(s => s.trim());
  ok(nav.includes('My JSAs'), `${tag} tech: his own JSAs`, nav.join(', '));
  ok(!nav.includes('Logs'), `${tag} tech: still NO master log`, nav.join(', '));
  const tiles = (await page.locator('.tile b').allTextContents()).map(s => s.trim());
  ok(tiles.includes('JSA'), `${tag} the built-in JSA is on the tiles`);
  ok(tiles.includes('JSA (old app)'),
    `${tag} the old app is still reachable during the changeover`);

  await openForm();
  ok(await page.locator('#jform').count() === 1, `${tag} the JSA form draws`);
  ok(await page.evaluate(() => !document.querySelector('.frame')),
    `${tag} and it is the app, not an iframe of another page`);
  ok(await page.locator('[data-haz]').count() === 12,
    `${tag} all twelve hazard categories are drawn`);
  ok(await page.locator('[data-ppe]').count() === 11, `${tag} eleven PPE boxes`);
  ok(await page.locator('[data-loto]').count() === 5, `${tag} five energy sources`);
  ok(await page.locator('.steprow').count() === 2, `${tag} two job-step rows to start`);
  ok(await page.inputValue('[data-j="jsaTech"]') === 'Clint',
    `${tag} the technician is filled in already`);
  ok(await page.inputValue('[data-j="preparedBy"]') === 'Clint',
    `${tag} so is the signature line`);
  ok((await page.inputValue('[data-j="jsaDate"]')).length === 16,
    `${tag} and the date and time`);
  ok(/0 of 12 categories answered/.test(await page.locator('#jtally').textContent()),
    `${tag} the tally starts at nothing answered`);

  // every permit is drawn but closed, and says what opens it
  for (const key of TPL.permitOrder) {
    ok(await page.locator(`[data-permit="${key}"]`).isHidden(),
      `${tag} the ${key} permit starts closed`);
  }
  ok(await page.locator('#lotoDetail').isHidden(), `${tag} the LOTO details start closed`);
  ok(await page.locator('.item .trig').count() === 3,
    `${tag} the three trigger categories say so on the form`);

  // ---- it will not file an unanswered review ----------------------
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(250);
  ok(/12 hazard categories not answered/.test(await msg()),
    `${tag} an unanswered review is refused by count`, await msg());
  ok(await page.locator('.sheet').count() === 0, `${tag} and nothing was filed`);

  // ---- a refusal has to take you TO the problem -------------------
  // This is the one Mike hit: all NO, and it would not file, and the reason
  // was printed somewhere he had to go looking for.
  await markAll('no');
  await setJ('jsaSite', 'Shop');
  await setJ('jsaTaskDesc', 'Change the rotary head seals');
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(600);
  const refusal = await msg();
  ok(/Answer the daily risk reflection/.test(refusal),
    `${tag} the reflection is asked for in words, not by printing its label`,
    refusal.replace(/\n/g, ' | ').slice(0, 140));
  ok(!/^What's the most dangerous task of your day\?$/m.test(refusal),
    `${tag} and never as a bare question with no instruction`);
  ok(await page.locator('.badfield').count() === 1,
    `${tag} exactly one field is marked as the one to fix`,
    String(await page.locator('.badfield').count()));
  const marked = await page.evaluate(() => {
    const b = document.querySelector('.badfield');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { has: !!b.querySelector('[data-col="desc"], [data-j], textarea, input'),
      onScreen: r.top > -200 && r.top < window.innerHeight + 200 };
  });
  ok(marked && marked.has, `${tag} and it is a field, not a heading`);
  ok(marked && marked.onScreen, `${tag} and the page has scrolled to it`,
    JSON.stringify(marked));

  // fixing it and pressing again walks you to the next one
  await setJ('mostDangerousTask', 'Pulling the head on the deck');
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(600);
  ok(!/daily risk reflection/.test(await msg()),
    `${tag} fixing one clears it from the list`);
  ok(await page.locator('.badfield').count() === 1,
    `${tag} and it moves on to the next thing`);

  // ---- big enough to use with gloves on ---------------------------
  if (size.width === 390) {
    const small = await page.evaluate(() => {
      const tiny = [];
      document.querySelectorAll('#view button, #view select, #view input, '
        + '.top button').forEach(e => {
        if (e.type === 'hidden' || e.hidden) return;
        /* a checkbox's hit area is its label, not the box - measure what a
           thumb actually lands on */
        const target = e.type === 'checkbox' ? (e.closest('label') || e) : e;
        const r = target.getBoundingClientRect();
        if (r.height > 0 && r.height < 44) {
          tiny.push((target.className || target.tagName) + ' ' + Math.round(r.height) + 'px');
        }
      });
      return [...new Set(tiny)];
    });
    ok(small.length === 0,
      `${tag} nothing interactive is under 44px - this is used with gloves on`,
      small.slice(0, 6).join(' ; '));
  }

  // ---- a YES has to say what the controls are ---------------------
  await markAll('no');
  await mark('pinch', 'yes');
  await page.waitForTimeout(120);
  ok(await page.locator('[data-haz="pinch"] textarea').isVisible(),
    `${tag} answering YES asks for the controls`);
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(250);
  ok(/is a YES — write the controls for it/.test(await msg()),
    `${tag} a YES with no controls is refused`, await msg());
  await controls('pinch', 'Hands clear, use a bar not fingers');

  // ---- a clean JSA files and reads back as the form ---------------
  await fillTheRest();
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(900);
  ok(await page.locator('.sheet').count() === 1, `${tag} a complete JSA files`);
  ok((await page.locator('.stamp').textContent()).trim() === 'NO PERMIT',
    `${tag} and comes back stamped NO PERMIT`);
  ok(await page.locator('.sline').count() === 12,
    `${tag} the record carries all twelve categories, not just the hazards found`,
    String(await page.locator('.sline').count()));
  ok(/Hands clear, use a bar not fingers/.test(
      (await page.locator('.sitem').allTextContents()).join(' ')),
    `${tag} the controls are written on the category they belong to`);
  ok(await page.locator('.sstep').count() === 1, `${tag} the job step is on the record`);
  ok(/JSA v1/.test(await page.locator('.ssign').textContent()),
    `${tag} the record says which version of the form it was signed on`);
  const ret = await page.locator('.note').first().textContent();
  ok(/Scheduled to drop off/.test(ret), `${tag} a JSA gets a retention date`, ret);
  const shown = new Date(ret.replace(/^[\s\S]*drop off /, '').replace(/\.\s*$/, ''));
  const days = Math.round((shown - new Date()) / 86400000);
  ok(Math.abs(days - RETENTION_DAYS) <= 2, `${tag} 13 months out`, `${days} days`);
  ok(await page.locator('[data-hold]').count() === 0,
    `${tag} a tech cannot put a legal hold on anything`);

  // ---- THE ONE THAT MATTERS: a permit cannot be signed blank ------
  await goHome();
  await openForm();
  await markAll('no');
  await mark('confined', 'yes');
  await page.waitForTimeout(200);
  ok(await page.locator('[data-permit="confined"]').isVisible(),
    `${tag} YES on confined space opens the entry permit`);
  ok(await page.locator('[data-permit="hotwork"]').isHidden(),
    `${tag} and does not open the others`);
  ok(/1 permit required/.test(await page.locator('#jtally').textContent()),
    `${tag} the tally says a permit is now required`);
  await controls('confined', 'Permit, attendant, continuous monitoring');
  await fillTheRest();
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(300);
  let m = await msg();
  ok(/Confined Space Entry Permit/.test(m),
    `${tag} a blank confined-space permit is refused`, m.slice(0, 120));
  ok(/Oxygen %/.test(m), `${tag} and it names the missing oxygen reading`);
  ok(/Attendant/.test(m), `${tag} and the missing attendant`);
  ok(/Rescue\/retrieval equipment ready/.test(m),
    `${tag} and the unconfirmed rescue equipment`);
  ok(await page.locator('.sheet').count() === 0,
    `${tag} nothing was filed with a blank permit`);

  // fill the permit properly and it goes through
  for (const [k, v] of [['csSpaceName', 'Receiver tank 2'], ['csEntrants', '1'],
    ['csOxygen', '20.9'], ['csLEL', '0'], ['csCO', '0'], ['csH2S', '0'],
    ['csSupervisor', 'Stew Roth'], ['csAttendant', 'Noah'],
    ['csCommMethod', 'Radio ch 3'], ['csValidFrom', '07:00'], ['csValidTo', '15:00']]) {
    await setJ(k, v);
  }
  await setJ('csVentilation', true);
  await setJ('csRescueReady', true);
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(900);
  ok(await page.locator('.sheet').count() === 1,
    `${tag} a completed permit files`, (await msg()).slice(0, 120));
  ok((await page.locator('.stamp').textContent()).trim() === '1 PERMIT',
    `${tag} and the record is stamped with the permit`);
  const sheet = await page.locator('.sheet').textContent();
  ok(/Confined Space Entry Permit/.test(sheet),
    `${tag} the permit is reproduced on the record`);
  ok(/20\.9/.test(sheet) && /Radio ch 3/.test(sheet),
    `${tag} with the readings that were taken`);
  ok(!/Hot Work Permit/.test(sheet),
    `${tag} and no permit that was never opened`);

  // ---- LOTO only asks once it is required ------------------------
  await goHome();
  await openForm();
  await markAll('na');
  await setJ('lotoRequired', 'yes');
  await page.waitForTimeout(250);
  ok(await page.locator('#lotoDetail').isVisible(),
    `${tag} saying LOTO is required opens its details`);
  await fillTheRest();
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(300);
  m = await msg();
  ok(/energy sources were isolated/.test(m),
    `${tag} LOTO with no energy source named is refused`, m.slice(0, 120));
  await setJ('lotoZeroEnergy', true);
  await setJ('lotoAppliedBy', 'Clint');
  await setJ('lotoLockCount', '2');
  await page.evaluate(() => document.querySelector('[data-loto="1"]').click());
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(900);
  ok(await page.locator('.sheet').count() === 1, `${tag} a complete LOTO files`,
    (await msg()).slice(0, 120));
  ok(/Hydraulic/.test(await page.locator('.sheet').textContent()),
    `${tag} and the isolated source is on the record`);

  // ---- a half-filled step is refused -----------------------------
  await goHome();
  await openForm();
  await markAll('no');
  await setJ('jsaSite', 'Shop');
  await setJ('jsaTaskDesc', 'Bench work');
  await setJ('mostDangerousTask', 'Nothing much');
  await setJ('crewAckCheck', true);
  await page.evaluate(() => {
    document.querySelector('.steprow[data-step="1"] [data-col="desc"]').value = 'Lift pump';
  });
  await page.locator('#jsubmit').click();
  await page.waitForTimeout(300);
  m = await msg();
  ok(/Step 1 is half filled in/.test(m), `${tag} a half-written step is refused`,
    m.slice(0, 120));

  // ---- the tech's own, and only his own --------------------------
  await goHome();
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My JSAs/.test(r.textContent)).click();
  });
  await page.waitForTimeout(450);
  ok(await page.locator('[data-jsa]').count() === 3,
    `${tag} Clint sees the three JSAs he filed`,
    String(await page.locator('[data-jsa]').count()));
  ok(await page.locator('.spec').count() === 0, `${tag} and not the shop-wide tallies`);

  await be('demo-noah');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')]
      .find(r => /My JSAs/.test(r.textContent)).click();
  });
  await page.waitForTimeout(450);
  ok(await page.locator('[data-jsa]').count() === 0,
    `${tag} another tech sees none of Clint's JSAs`);

  // ---- office reads the log but cannot hold or amend -------------
  await be('demo-jaz');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')].find(r => /Logs/.test(r.textContent)).click();
  });
  await page.waitForTimeout(350);
  await page.locator('.list .row[data-go="jsalog"], .bar [data-go="jsalog"]').click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-jsa]').count() === 3, `${tag} office sees all three`);
  const spec = await page.locator('.spec').textContent();
  /* three filed: one with a YES but no permit, one confined-space entry, one
     LOTO job. Only the confined-space one carries a permit. */
  ok(/(^|[^0-9])1with a permit/.test(spec),
    `${tag} the log counts how many carry a permit`, spec.replace(/\s+/g, ' '));
  await page.locator('[data-jsa]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-hold]').count() === 0,
    `${tag} office cannot put a legal hold on a JSA`);

  // ---- owner: the legal hold -------------------------------------
  await be('demo-mike');
  await page.evaluate(() => {
    [...document.querySelectorAll('.list .row')].find(r => /Logs/.test(r.textContent)).click();
  });
  await page.waitForTimeout(350);
  await page.locator('.list .row[data-go="jsalog"], .bar [data-go="jsalog"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-jsa]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('[data-hold="on"]').count() === 1,
    `${tag} an owner can hold a JSA`);
  await page.fill('#holdwhy', 'Tank entry incident 10/22');
  await page.locator('[data-hold="on"]').click();
  await page.waitForTimeout(700);
  const held = await page.locator('.note').first().textContent();
  ok(/On legal hold/.test(held) && /Tank entry incident/.test(held),
    `${tag} a held JSA will not be deleted, and says why`, held);
  ok(!/Scheduled to drop off/.test(held),
    `${tag} and has no expiry date while the hold is on`, held);
  const nulled = await page.evaluate(() => {
    const rows = JSON.parse(sessionStorage.getItem('bsds.jsas') || '[]');
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
