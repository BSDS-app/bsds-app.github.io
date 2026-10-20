/* Pre-Op inspections, inside the app.
 *
 * Three things this file is responsible for, and they are deliberately not
 * the same thing:
 *
 *   1. drawing the form a tech fills in,
 *   2. storing what they filled in, with a retention date on it,
 *   3. drawing a stored record BACK AS THE FORM - not as a row of a
 *      spreadsheet.
 *
 * (3) is the whole reason this exists. A pre-op is a signed statement that
 * somebody walked around a machine on a date and found it fit. Read back as
 * 33 columns it is data; read back as the sheet he signed it is a record. If
 * MSHA, a customer or a lawyer ever asks for one, they get the second thing.
 *
 * Which is also why every record stores its own line items in full rather
 * than only pointing at a template. The template version is stored too, so a
 * record always renders with the checklist that existed when it was signed -
 * never with rows added later. But if the template file were ever lost, the
 * record is still readable on its own. A compliance record that depends on
 * another file to be legible is not a compliance record.
 *
 * Retention: see config.retention. Two clocks, not one, because MSHA has two:
 *   - 30 CFR 56.18002(b): a workplace examination record is kept one year.
 *   - 30 CFR 56.14100(d): an equipment DEFECT record is kept from the date it
 *     is recorded "until the defects are corrected".
 * So a sheet with an uncorrected fail on it has no expiry date at all. It
 * gets one when the fail is signed off as corrected, and the clock then runs
 * from the later of the two dates.
 */
import { CONFIG } from './config.js';
import * as auth from './auth.js';
import { asDate, expiryFor as retentionExpiry, describe } from './retention.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const RESULT_LABEL = { pass: 'Pass', fail: 'Fail', na: 'N/A' };

/* ---------- the template -------------------------------------------- */

const cache = new Map();

export async function template(version) {
  const v = version || CONFIG.retention.preop.formVersion;
  if (cache.has(v)) return cache.get(v);
  const r = await fetch(`forms/preop.v${v}.json`);
  if (!r.ok) throw new Error(`pre-op form template v${v} is missing`);
  const t = await r.json();
  cache.set(v, t);
  return t;
}

/* Fall protection is the odd one out: its checklist depends on the frequency,
   not on the machine. Everything else ignores the frequency. */
export function sectionsFor(tpl, typeKey, freq) {
  const t = tpl.types[typeKey];
  if (!t) return null;
  if (t.sections) return t.sections;
  if (t.byFrequency) return t.byFrequency[freq] || null;
  return null;
}
export function needsFrequency(tpl, typeKey) {
  const t = tpl.types[typeKey];
  return !!(t && t.byFrequency);
}
export function lineCount(tpl, typeKey, freq) {
  const s = sectionsFor(tpl, typeKey, freq);
  return s ? Object.values(s).reduce((a, v) => a + v.length, 0) : 0;
}

/* ---------- dates and retention --------------------------------------
   The arithmetic itself lives in retention.js, shared with the JSA. What
   is pre-op-specific is the one thing that holds a sheet open: a failed
   line nobody has signed off yet. */

export const openDefects = rec =>
  (rec.items || []).filter(i => i.r === 'fail' && !i.c).length;

export function expiryFor(rec, days) {
  return retentionExpiry({
    hold: rec.hold,
    filed: rec.inspDate || rec.createdAt,
    /* the latest correction, if any - fixing something in March must not
       start the clock from last October */
    since: (rec.items || []).map(i => asDate(i.cAt)).filter(Boolean)
      .reduce((a, d) => (a && a > d ? a : d), null),
    blocked: openDefects(rec) > 0,
  }, days);
}

export function retentionNote(rec) {
  const open = openDefects(rec);
  return describe({
    hold: rec.hold,
    holdReason: rec.holdReason,
    blockedText: open
      ? open + ' uncorrected defect' + (open === 1 ? '' : 's')
        + ' — kept until corrected, per 30 CFR 56.14100(d)'
      : '',
    expires: expiryFor(rec, CONFIG.retention.preop.days),
  });
}

/* ---------- building a record ----------------------------------------- */

/* Reads the drawn form. Returns { rec } or { problems: [...] }. Nothing is
   written until this comes back clean. */
export function collect(root, tpl, ctx) {
  const problems = [];
  const val = k => {
    const el = root.querySelector('[data-f="' + k + '"]');
    return el ? String(el.value || '').trim() : '';
  };
  const typeKey = val('eqType');
  const freq = val('inspFrequency') || 'daily';
  if (!typeKey) problems.push('Pick the equipment type.');
  const secs = typeKey ? sectionsFor(tpl, typeKey, freq) : null;
  if (typeKey && !secs) problems.push('That equipment type has no checklist for that frequency.');

  const items = [];
  let missing = 0;
  if (secs) {
    let n = 0;
    for (const [section, lines] of Object.entries(secs)) {
      lines.forEach((text, j) => {
        const row = root.querySelector('[data-item="' + n + '"]');
        const on = row ? row.querySelector('.res.on') : null;
        const noteEl = row ? row.querySelector('textarea') : null;
        const r = on ? on.dataset.result : '';
        if (!r) missing++;
        items.push({ s: section, i: text, r: r, n: noteEl ? noteEl.value.trim() : '' });
        n++;
      });
    }
    /* The gate that matters: the number of lines on the record has to equal
       the number of lines in the template. A form that quietly submits 25 of
       26 lines is the failure this project keeps having. */
    const want = lineCount(tpl, typeKey, freq);
    if (items.length !== want) {
      problems.push(`The form drew ${items.length} lines but the checklist has ${want}. `
        + 'Not submitting a partial record.');
    }
  }
  if (missing) {
    problems.push(missing + ' line' + (missing === 1 ? '' : 's')
      + ' not marked. Every line needs Pass, Fail or N/A.');
  }
  const failed = items.filter(i => i.r === 'fail');
  failed.forEach(i => { if (!i.n) problems.push('A failed line needs a note: “' + i.i + '”'); });

  if (!val('operatorName')) problems.push('Operator name.');
  if (!val('inspDate')) problems.push('Date and time of the inspection.');
  if (!val('signName')) problems.push('Sign it — type your name at the bottom.');

  if (problems.length) return { problems };

  const u = auth.currentUser();
  const t = tpl.types[typeKey];
  const unitRaw = val('eqUnit');
  const match = (ctx.equipment || []).find(e =>
    e.unit && unitRaw && String(e.unit).toUpperCase() === unitRaw.toUpperCase());

  const rec = {
    uid: u.uid, byName: u.name, byEmail: u.email || '',
    form: 'preop', formVersion: tpl.version,
    eqType: typeKey, eqTypeLabel: t.label,
    inspFrequency: needsFrequency(tpl, typeKey) ? freq : 'daily',
    unit: unitRaw,
    unitId: match ? match.id : '',
    serial: match ? (match.serial || '') : '',
    customer: match ? (match.customer || '') : '',
    customerName: match ? (match.customerName || '') : '',
    meterLabel: t.meterLabel,
    meterReading: val('meterReading'),
    operatorName: val('operatorName'),
    siteName: val('siteName'),
    inspDate: new Date(val('inspDate')).toISOString(),
    items,
    passes: items.filter(i => i.r === 'pass').length,
    fails: failed.length,
    nas: items.filter(i => i.r === 'na').length,
    result: failed.length ? 'fail' : 'pass',
    overallNotes: val('overallNotes'),
    signName: val('signName'),
    hold: false, holdReason: '',
    retentionDays: CONFIG.retention.preop.days,
  };
  rec.expiresAt = expiryFor(rec, rec.retentionDays);
  return { rec };
}

/* ---------- storage --------------------------------------------------- */
/* Demo mode keeps records in sessionStorage so the whole flow can be walked
   through - and tested - without a network. Live mode writes to Firestore,
   where firestore.rules is what actually decides who may read them back. */

const DEMO_KEY = 'bsds.preops';
const demoAll = () => {
  try { return JSON.parse(sessionStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; }
};
const demoPut = rows => {
  try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(rows)); } catch (e) {}
};

export async function save(rec) {
  if (auth.currentUser() && auth.currentUser().demo) {
    const rows = demoAll();
    const id = 'demo-' + Date.now();
    rows.unshift({ id, ...rec, createdAt: new Date().toISOString(),
      expiresAt: rec.expiresAt ? rec.expiresAt.toISOString() : null });
    demoPut(rows);
    return id;
  }
  const { d, m } = await auth.db();
  const ref = await m.addDoc(m.collection(d, 'preops'), {
    ...rec,
    inspDate: m.Timestamp.fromDate(new Date(rec.inspDate)),
    expiresAt: rec.expiresAt ? m.Timestamp.fromDate(rec.expiresAt) : null,
    createdAt: m.serverTimestamp(),
  });
  return ref.id;
}

export async function list(opts) {
  const o = opts || {};
  const u = auth.currentUser();
  if (u && u.demo) {
    let rows = demoAll();
    if (u.role === 'tech') rows = rows.filter(r => r.uid === u.uid);
    return rows.slice(0, o.limit || 200);
  }
  const { d, m } = await auth.db();
  const parts = [m.collection(d, 'preops')];
  /* A tech is only ever allowed their own, so ask for their own - a query the
     rules would refuse comes back as an error, not as an empty list, and an
     error here would look like "no inspections" on screen. */
  if (u.role === 'tech') parts.push(m.where('uid', '==', u.uid));
  parts.push(m.orderBy('inspDate', 'desc'), m.limit(o.limit || 200));
  const snap = await m.getDocs(m.query(...parts));
  return snap.docs.map(x => ({ id: x.id, ...x.data() }));
}

export async function get(id) {
  const u = auth.currentUser();
  if (u && u.demo) return demoAll().find(r => r.id === id) || null;
  const { d, m } = await auth.db();
  const snap = await m.getDoc(m.doc(d, 'preops', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* Marking a defect corrected is what starts the retention clock on a record
   that was being kept because of it. Office and owners only - a tech filing
   the sheet does not get to close out his own defect. */
export async function correct(id, indexes, note) {
  const rec = await get(id);
  if (!rec) throw new Error('no such inspection');
  const u = auth.currentUser();
  const now = new Date();
  const items = (rec.items || []).map((it, n) =>
    indexes.indexOf(n) >= 0 && it.r === 'fail' && !it.c
      ? { ...it, c: true, cAt: now.toISOString(), cBy: u.name, cNote: note || '' }
      : it);
  const next = { ...rec, items };
  const exp = expiryFor(next, rec.retentionDays || CONFIG.retention.preop.days);
  if (u.demo) {
    demoPut(demoAll().map(r => r.id === id
      ? { ...next, expiresAt: exp ? exp.toISOString() : null } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'preops', id), {
    items, expiresAt: exp ? m.Timestamp.fromDate(exp) : null,
  });
}

/* A legal hold takes the expiry date off. Firestore's own retention mechanism
   skips any document whose expiry field is absent or null, so this is not a
   flag something has to remember to check - it is the absence of the thing
   that does the deleting. Owners only. */
export async function setHold(id, on, reason) {
  const rec = await get(id);
  if (!rec) throw new Error('no such inspection');
  const u = auth.currentUser();
  const next = { ...rec, hold: !!on };
  const exp = expiryFor(next, rec.retentionDays || CONFIG.retention.preop.days);
  const patch = {
    hold: !!on,
    holdReason: on ? (reason || '') : '',
    holdBy: on ? u.name : '',
    holdAt: on ? new Date().toISOString() : '',
  };
  if (u.demo) {
    demoPut(demoAll().map(r => r.id === id
      ? { ...r, ...patch, expiresAt: exp ? exp.toISOString() : null } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'preops', id), {
    ...patch, expiresAt: exp ? m.Timestamp.fromDate(exp) : null,
  });
}

/* ---------- drawing the blank form ----------------------------------- */

function field(f, tpl, ctx) {
  const id = 'f_' + f.key;
  const lab = l => '<label for="' + id + '">' + esc(l) + '</label>';
  if (f.kind === 'type') {
    return lab(f.label) + '<select id="' + id + '" data-f="eqType">'
      + '<option value="">— choose —</option>'
      + tpl.typeOrder.map(k => '<option value="' + esc(k) + '">'
          + esc(tpl.types[k].label) + '</option>').join('')
      + '</select>';
  }
  if (f.kind === 'frequency') {
    return '<div class="fq" hidden>' + lab(f.label) + '<select id="' + id
      + '" data-f="inspFrequency">'
      + tpl.frequencies.map(x => '<option value="' + esc(x.value) + '">'
          + esc(x.label) + '</option>').join('')
      + '</select></div>';
  }
  if (f.kind === 'unit') {
    const units = (ctx.equipment || []).slice()
      .sort((a, b) => String(a.unit).localeCompare(String(b.unit)));
    return lab(f.label) + '<input id="' + id + '" data-f="eqUnit" list="unitlist" '
      + 'autocomplete="off" spellcheck="false" placeholder="Unit number">'
      + '<datalist id="unitlist">'
      + units.map(e => '<option value="' + esc(e.unit) + '">'
          + esc([e.customerName, e.model].filter(Boolean).join(' · ')) + '</option>').join('')
      + '</datalist>'
      + '<p class="hint">Anything in the Fullbay list will fill in its customer and '
      + 'serial by itself. Forklifts, harnesses and anything else not on that list — '
      + 'just type it.</p>';
  }
  if (f.kind === 'meter') {
    return '<label for="' + id + '" data-meter>Hour Meter</label>'
      + '<input id="' + id + '" data-f="meterReading" inputmode="numeric" autocomplete="off">';
  }
  if (f.kind === 'datetime') {
    return lab(f.label) + '<input id="' + id + '" data-f="' + f.key + '" type="datetime-local">';
  }
  if (f.kind === 'textarea') {
    return lab(f.label) + '<textarea id="' + id + '" data-f="' + f.key + '" rows="3"></textarea>';
  }
  return lab(f.label) + '<input id="' + id + '" data-f="' + f.key + '" type="text" '
    + 'autocomplete="off">';
}

export function drawForm(host, tpl, ctx) {
  const u = auth.currentUser();
  const h = ['<div class="wrap"><h1 class="pg">Pre-Op Inspection</h1>',
    '<p class="lede">The same walk-around as always. It saves in the app now, so it '
    + 'reads back as this sheet rather than as a row of a spreadsheet.</p>',
    '<form class="pform" id="pform" novalidate>',
    '<h2 class="sec">Inspection details</h2><div class="fgrid">'];
  tpl.header.forEach(f => h.push('<div class="fld">', field(f, tpl, ctx), '</div>'));
  h.push('</div>');
  h.push('<div id="chk"><div class="note">Pick the equipment type and the checklist '
    + 'for it appears here.</div></div>');
  h.push('<h2 class="sec">Sign-off</h2><div class="fgrid">');
  tpl.footer.forEach(f => h.push('<div class="fld">', field(f, tpl, ctx), '</div>'));
  h.push('</div>');
  h.push('<p class="msg" id="pmsg"></p>',
    '<button type="button" class="btn primary" id="psubmit">Submit inspection</button>',
    '</form>');
  h.push('<div class="note"><b>How long this is kept.</b> ',
    esc(CONFIG.retention.preop.label),
    ', then it drops off by itself. A sheet with a defect that has not been signed '
    + 'off as corrected is kept past that until it is — MSHA requires the defect record '
    + 'until the defect is fixed, which is a different clock from the one-year '
    + 'examination record.</div>');
  h.push('</div>');
  host.innerHTML = h.join('');

  /* Prefill what we already know rather than making him type it. */
  const set = (k, v) => {
    const el = host.querySelector('[data-f="' + k + '"]');
    if (el && v != null) el.value = v;
  };
  set('operatorName', u.name);
  set('signName', u.name);
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  set('inspDate', now.toISOString().slice(0, 16));
}

/* The checklist, redrawn whenever the type or frequency changes. */
export function drawChecklist(host, tpl) {
  const typeEl = host.querySelector('[data-f="eqType"]');
  const freqEl = host.querySelector('[data-f="inspFrequency"]');
  const wrapFq = host.querySelector('.fq');
  const key = typeEl ? typeEl.value : '';
  const box = host.querySelector('#chk');
  if (wrapFq) wrapFq.hidden = !(key && needsFrequency(tpl, key));

  const meterLab = host.querySelector('[data-meter]');
  if (meterLab && key) meterLab.textContent = tpl.types[key].meterLabel;

  if (!key) {
    box.innerHTML = '<div class="note">Pick the equipment type and the checklist '
      + 'for it appears here.</div>';
    return;
  }
  const secs = sectionsFor(tpl, key, freqEl ? freqEl.value : 'daily');
  if (!secs) {
    box.innerHTML = '<div class="note warn">No checklist on file for that '
      + 'combination.</div>';
    return;
  }
  const h = [];
  let n = 0;
  for (const [section, lines] of Object.entries(secs)) {
    h.push('<h2 class="sec">', esc(section), '</h2><div class="items">');
    lines.forEach(text => {
      h.push('<div class="item" data-item="', n, '">',
        '<div class="itxt">', esc(text), '</div>',
        '<div class="ibtn">',
        tpl.resultChoices.map(c => '<button type="button" class="res" data-result="'
          + esc(c.value) + '">' + esc(c.label) + '</button>').join(''),
        '</div>',
        '<textarea rows="1" placeholder="Note (required if this fails)" hidden></textarea>',
        '</div>');
      n++;
    });
    h.push('</div>');
  }
  h.push('<p class="tally" id="tally"></p>');
  box.innerHTML = h.join('');
  tally(host);
}

/* The form's own click handling. Returned true means "handled", so app.js
   stops rather than also treating it as navigation. The JSA has a function
   of the same name - both forms use the same Pass/Fail buttons, and app.js
   asks whichever form is on screen. */
export function formClick(e, host) {
  const res = e.target.closest('.res');
  if (!res || !host.contains(res)) return false;
  const item = res.closest('.item');
  item.querySelectorAll('.res').forEach(b => b.classList.toggle('on', b === res));
  /* A failed line has to say why. The box appears when it is needed rather
     than sitting under all 33 lines asking to be ignored. */
  const note = item.querySelector('textarea');
  const failed = res.dataset.result === 'fail';
  if (note) {
    note.hidden = !failed && !note.value.trim();
    note.rows = failed ? 2 : 1;
    if (failed) note.focus();
  }
  tally(host);
  return true;
}

export function tally(host) {
  const items = host.querySelectorAll('.item');
  let marked = 0, f = 0;
  items.forEach(it => {
    const on = it.querySelector('.res.on');
    if (on) { marked++; if (on.dataset.result === 'fail') f++; }
  });
  const el = host.querySelector('#tally');
  if (el) {
    el.textContent = marked + ' of ' + items.length + ' lines marked'
      + (f ? ' · ' + f + ' fail' + (f === 1 ? '' : 's') : '');
    el.className = 'tally' + (marked === items.length ? ' done' : '');
  }
}

/* ---------- drawing a stored record AS THE FORM ---------------------- */

export function drawRecord(host, rec, opts) {
  const o = opts || {};
  const note = retentionNote(rec);
  const when = asDate(rec.inspDate);
  /* `ix`, not `n` - on a stored item `n` is the note the tech typed, and
     spending that key on the row number is how the note vanished the first
     time this was written. */
  const grouped = [];
  (rec.items || []).forEach((it, ix) => {
    let g = grouped[grouped.length - 1];
    if (!g || g.s !== it.s) { g = { s: it.s, rows: [] }; grouped.push(g); }
    g.rows.push({ ...it, ix });
  });

  const h = ['<div class="wrap"><div class="sheet">'];
  h.push('<div class="shead"><div><b>Pre-Op Inspection</b>',
    '<span>Broken Spoke Drilling Solutions</span></div>',
    '<div class="stamp ', esc(rec.result), '">', rec.result === 'fail' ? 'FAIL' : 'PASS',
    '</div></div>');

  const row = (k, v) => '<div><span>' + esc(k) + '</span><b>'
    + (v ? esc(v) : '<i>not recorded</i>') + '</b></div>';
  h.push('<div class="sgrid">',
    row('Equipment type', rec.eqTypeLabel),
    row('Unit', rec.unit),
    row('Serial', rec.serial),
    row('Customer', rec.customerName),
    row(rec.meterLabel || 'Meter', rec.meterReading),
    row('Site', rec.siteName),
    row('Operator', rec.operatorName),
    row('Date', when ? when.toLocaleString() : ''),
    row('Frequency', rec.inspFrequency === 'annual'
      ? 'Annual / Periodic (Competent Person)' : 'Daily / Pre-Use'),
    '</div>');

  grouped.forEach(g => {
    h.push('<h3 class="ssec">', esc(g.s), '</h3><div class="slines">');
    g.rows.forEach(r => {
      h.push('<div class="sline ', esc(r.r || 'blank'), '">',
        '<span class="sres">', esc(RESULT_LABEL[r.r] || '—'), '</span>',
        '<span class="sitem">', esc(r.i),
        r.n ? '<em>' + esc(r.n) + '</em>' : '',
        r.c ? '<ins>Corrected ' + esc(asDate(r.cAt) ? asDate(r.cAt).toLocaleDateString() : '')
              + (r.cBy ? ' by ' + esc(r.cBy) : '')
              + (r.cNote ? ' — ' + esc(r.cNote) : '') + '</ins>' : '',
        '</span></div>');
    });
    h.push('</div>');
  });

  h.push('<h3 class="ssec">Overall notes</h3>',
    '<div class="sbody">', rec.overallNotes ? esc(rec.overallNotes)
      : '<i>none written</i>', '</div>');
  h.push('<div class="ssign"><div><span>Signed</span><b>', esc(rec.signName || ''),
    '</b></div><div><span>Filed by</span><b>', esc(rec.byName || ''), '</b></div>',
    '<div><span>Lines</span><b>', (rec.items || []).length, ' · ', rec.passes,
    ' pass / ', rec.fails, ' fail / ', rec.nas, ' n-a</b></div>',
    '<div><span>Form</span><b>Pre-Op v', esc(rec.formVersion), '</b></div></div>');
  h.push('</div>');

  h.push('<div class="note', note.kind === 'hold' || note.kind === 'open' ? ' warn' : '',
    '"><b>Retention.</b> ', esc(note.text), '.</div>');

  const open = (rec.items || []).map((it, ix) => ({ ...it, ix }))
    .filter(it => it.r === 'fail' && !it.c);
  if (open.length && o.canCorrect) {
    h.push('<h2 class="sec">Defects still open</h2><div class="list">');
    open.forEach(it => h.push('<div class="row"><span><span class="nm">', esc(it.i),
      '</span><span class="sub">', esc(it.n || 'no note'), '</span></span>',
      '<button class="mini" data-fix="', it.ix, '">Mark corrected</button></div>'));
    h.push('</div><p class="hint">Marking the last one corrected is what starts the '
      + 'retention clock on this record.</p>');
  }
  if (o.canHold) {
    h.push('<h2 class="sec">Legal hold</h2>');
    h.push(rec.hold
      ? '<div class="note warn"><b>Held.</b> ' + esc(rec.holdReason || 'no reason given')
        + (rec.holdBy ? ' — set by ' + esc(rec.holdBy) : '')
        + '<br><button class="mini" data-hold="off">Release the hold</button></div>'
      : '<div class="note"><b>Not held.</b> Put a hold on this sheet if it is '
        + 'evidence in an incident, a citation contest or a customer dispute — a held '
        + 'record has no expiry date and cannot be deleted by the purge.'
        + '<br><input id="holdwhy" type="text" placeholder="Why (goes on the record)">'
        + '<button class="mini" data-hold="on">Put this on hold</button></div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

/* ---------- the log --------------------------------------------------- */

export function drawLog(host, rows, opts) {
  const o = opts || {};
  const h = ['<div class="wrap"><h1 class="pg">Pre-op inspections</h1>'];
  h.push('<p class="lede">', o.mine
    ? 'The sheets you have filed. Techs see their own; the full log is office and owners.'
    : 'Every sheet on file. Click one to read it back as the form it was signed on.',
    '</p>');
  if (!rows.length) {
    h.push('<div class="empty">Nothing filed yet.</div></div>');
    host.innerHTML = h.join('');
    return;
  }
  const held = rows.filter(r => r.hold).length;
  const openRecs = rows.filter(r => openDefects(r) > 0).length;
  if (!o.mine) {
    h.push('<div class="spec">',
      '<div><b>', rows.length, '</b><span>on file</span></div>',
      '<div><b>', rows.filter(r => r.result === 'fail').length, '</b><span>with a fail</span></div>',
      '<div', openRecs ? '' : ' class="missing"', '><b>', openRecs,
      '</b><span>defects open</span></div>',
      '<div', held ? '' : ' class="missing"', '><b>', held, '</b><span>on hold</span></div>',
      '</div>');
  }
  h.push('<div class="find"><input id="pq" type="search" ',
    'placeholder="Unit, operator, customer or site" autocomplete="off"></div>');
  h.push('<div class="list" id="prows">', rows.map(logRow).join(''), '</div></div>');
  host.innerHTML = h.join('');

  const q = host.querySelector('#pq');
  if (q) {
    q.addEventListener('input', () => {
      const t = q.value.trim().toUpperCase();
      const hit = !t ? rows : rows.filter(r =>
        [r.unit, r.operatorName, r.customerName, r.siteName, r.eqTypeLabel]
          .join(' ').toUpperCase().includes(t));
      host.querySelector('#prows').innerHTML = hit.length
        ? hit.map(logRow).join('')
        : '<div class="empty">Nothing matches.</div>';
    });
  }
}

function logRow(r) {
  const d = asDate(r.inspDate);
  const open = openDefects(r);
  return '<button class="row" data-preop="' + esc(r.id) + '">'
    + '<span><span class="nm">' + esc(r.unit || r.eqTypeLabel || 'Inspection')
    + '</span><span class="sub">'
    + [d ? d.toLocaleDateString() : '', r.operatorName, r.customerName]
        .filter(Boolean).map(esc).join(' · ')
    + '</span></span><span class="ct">'
    + '<b class="' + (r.result === 'fail' ? 'bad' : 'good') + '">'
    + (r.result === 'fail' ? r.fails + ' fail' : 'pass') + '</b>'
    + (r.hold ? 'held' : open ? open + ' open' : '')
    + '</span></button>';
}
