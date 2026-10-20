/* JSAs, inside the app.
 *
 * Same three jobs as preop.js - draw the form, store what was filled in,
 * read it back AS the form - and the same reason for the third one. But the
 * JSA is not a checklist, and treating it like one is how you get a JSA
 * that is worse than nothing.
 *
 * The shape that matters: twelve MSHA hazard categories, each answered NO,
 * YES or N/A. A YES needs controls written against it. And three of the
 * twelve are permit triggers - hot work, working at heights, confined space.
 * Answer YES there and a permit card opens that has to be completed before
 * the JSA can be signed. A confined-space entry signed off with no oxygen
 * reading, no attendant and no rescue plan is exactly the piece of paper
 * that gets read out at an inquest, so the form refuses to file it.
 *
 * Retention is the same 13 months and the same owner-only legal hold as the
 * pre-op, and the arithmetic is literally the same code (retention.js).
 * What a JSA does NOT have is the pre-op's second clock: there is no
 * equivalent of an uncorrected defect, so nothing holds a JSA open except a
 * hold somebody deliberately put on it. A YES hazard is not an open item -
 * it is the JSA doing its job.
 */
import { CONFIG } from './config.js';
import * as auth from './auth.js';
import { asDate, expiryFor as retentionExpiry, describe } from './retention.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STATUS_LABEL = { no: 'NO', yes: 'YES', na: 'N/A' };

/* ---------- the template -------------------------------------------- */

const cache = new Map();

export async function template(version) {
  const v = version || CONFIG.retention.jsa.formVersion;
  if (cache.has(v)) return cache.get(v);
  const r = await fetch(`forms/jsa.v${v}.json`);
  if (!r.ok) throw new Error(`JSA form template v${v} is missing`);
  const t = await r.json();
  cache.set(v, t);
  return t;
}

export const permitHazards = tpl => tpl.hazards.filter(h => h.permit);

/* ---------- retention ------------------------------------------------- */

export function expiryFor(rec, days) {
  return retentionExpiry({
    hold: rec.hold,
    filed: rec.jsaDate || rec.createdAt,
    blocked: false,
  }, days);
}

export function retentionNote(rec) {
  return describe({
    hold: rec.hold,
    holdReason: rec.holdReason,
    expires: expiryFor(rec, rec.retentionDays || CONFIG.retention.jsa.days),
  });
}

/* ---------- drawing the blank form ----------------------------------- */

function control(f, ctx) {
  const id = 'j_' + f.key;
  const lab = '<label for="' + id + '">' + esc(f.label)
    + (f.req ? '' : '') + '</label>';
  const common = 'id="' + id + '" data-j="' + esc(f.key) + '"';
  if (f.kind === 'check') {
    /* the label goes after the box for a checkbox, where a person expects it */
    return '<label class="chk"><input type="checkbox" ' + common + '><span>'
      + esc(f.label) + '</span></label>';
  }
  if (f.kind === 'select') {
    return lab + '<select ' + common + '>'
      + (f.options || []).map(o => '<option value="' + esc(o.value) + '">'
          + esc(o.label) + '</option>').join('')
      + '</select>';
  }
  if (f.kind === 'textarea') {
    return lab + '<textarea ' + common + ' rows="3"></textarea>';
  }
  if (f.kind === 'datetime') return lab + '<input ' + common + ' type="datetime-local">';
  if (f.kind === 'time') return lab + '<input ' + common + ' type="time">';
  if (f.kind === 'number') {
    return lab + '<input ' + common + ' type="number" min="0" inputmode="numeric">';
  }
  if (f.kind === 'tech') {
    return lab + '<input ' + common + ' type="text" autocomplete="off">';
  }
  if (f.kind === 'unit') {
    const units = (ctx.equipment || []).slice()
      .sort((a, b) => String(a.unit).localeCompare(String(b.unit)));
    return lab + '<input ' + common + ' list="junitlist" autocomplete="off" '
      + 'spellcheck="false" placeholder="Unit number, or describe it">'
      + '<datalist id="junitlist">'
      + units.map(e => '<option value="' + esc(e.unit) + '">'
          + esc([e.customerName, e.model].filter(Boolean).join(' · ')) + '</option>').join('')
      + '</datalist>';
  }
  return lab + '<input ' + common + ' type="text" autocomplete="off">';
}

/* Fields are drawn in the order the template lists them, with a subheading
   wherever the `group` changes. That is how the old app reads, and the
   groups carry meaning - "Atmospheric Testing" is four numbers that belong
   together, not four stray boxes. */
function fieldBlock(fields, ctx, filter) {
  const h = [];
  let group = null, open = false;
  fields.filter(filter || (() => true)).forEach(f => {
    const g = f.group || null;
    if (g !== group) {
      if (open) { h.push('</div>'); open = false; }
      group = g;
      if (g) { h.push('<h3 class="grp">', esc(g), '</h3>'); }
    }
    if (!open) { h.push('<div class="fgrid">'); open = true; }
    h.push('<div class="fld', f.kind === 'check' ? ' wide' : '', '">',
      control(f, ctx), '</div>');
  });
  if (open) h.push('</div>');
  return h.join('');
}

export function drawForm(host, tpl, ctx) {
  const u = auth.currentUser();
  const T = tpl.sectionTitles;
  const h = ['<div class="wrap"><h1 class="pg">', esc(tpl.title), '</h1>',
    '<p class="lede">The same JSA as always. It saves in the app now, so it reads '
    + 'back as this form rather than as a row of a spreadsheet.</p>',
    '<form class="pform" id="jform" novalidate>'];

  h.push('<h2 class="sec">', esc(T.header), '</h2>', fieldBlock(tpl.header, ctx));

  /* ---- hazard review ---- */
  h.push('<h2 class="sec">', esc(T.hazards), '</h2><div class="items">');
  tpl.hazards.forEach((hz, i) => {
    h.push('<div class="item" data-haz="', esc(hz.key), '" data-hi="', i, '">',
      '<div class="itxt">', esc(hz.label),
      hz.permit ? '<em class="trig">YES opens the '
        + esc(tpl.permits[hz.permit].title) + '</em>' : '',
      '</div><div class="ibtn">',
      tpl.statusChoices.map(c => '<button type="button" class="res" data-result="'
        + esc(c.value) + '">' + esc(c.label) + '</button>').join(''),
      '</div>',
      '<textarea rows="1" placeholder="', esc(tpl.controlsPrompt), '" hidden></textarea>',
      '</div>');
  });
  h.push('</div><p class="tally" id="jtally"></p>');

  /* ---- the three permits, drawn but closed ---- */
  tpl.permitOrder.forEach(key => {
    const p = tpl.permits[key];
    h.push('<div class="permit" data-permit="', esc(key), '" hidden>',
      '<h2 class="sec warn">', esc(p.title), '</h2>',
      '<div class="note warn">This permit is open because the hazard review says '
      + 'YES. Every line of it has to be filled in before the JSA can be signed.</div>',
      fieldBlock(p.fields, ctx), '</div>');
  });

  /* ---- PPE ---- */
  h.push('<h2 class="sec">', esc(T.ppe), '</h2><div class="chkgrid">');
  tpl.ppe.forEach((item, i) => h.push('<label class="chk"><input type="checkbox" ',
    'data-ppe="', i, '"><span>', esc(item), '</span></label>'));
  h.push('</div>');

  /* ---- LOTO ---- */
  h.push('<h2 class="sec">', esc(T.loto), '</h2>',
    fieldBlock(tpl.loto.fields, ctx, f => !f.whenLoto),
    '<div id="lotoDetail" hidden>',
    fieldBlock(tpl.loto.fields, ctx, f => f.whenLoto),
    '<h3 class="grp">', esc(T.lotoSources), '</h3><div class="chkgrid">',
    tpl.loto.sources.map((s, i) => '<label class="chk"><input type="checkbox" data-loto="'
      + i + '"><span>' + esc(s) + '</span></label>').join(''),
    '</div></div>');

  /* ---- job steps ---- */
  h.push('<h2 class="sec">', esc(T.steps), '</h2><div id="steps"></div>',
    '<button type="button" class="mini" id="jaddstep">+ Add step</button>');

  /* ---- reflection and sign-off ---- */
  h.push('<h2 class="sec">', esc(T.reflection), '</h2><div class="fgrid">',
    '<div class="fld wide">', control(tpl.reflection, ctx), '</div></div>');
  h.push('<h2 class="sec">', esc(T.signoff), '</h2>', fieldBlock(tpl.signoff, ctx));

  h.push('<p class="msg" id="jmsg"></p>',
    '<button type="button" class="btn primary" id="jsubmit">Submit JSA</button>',
    '</form>');
  h.push('<div class="note"><b>How long this is kept.</b> ',
    esc(CONFIG.retention.jsa.label), ', then it drops off by itself. ',
    'A JSA has no MSHA retention clock of its own, so that is a house rule rather '
    + 'than a legal floor — it matches the pre-ops so there is one answer to the '
    + 'question. Mike or Stew can put a hold on any JSA, which stops it being '
    + 'deleted at all.</div></div>');
  host.innerHTML = h.join('');

  for (let i = 0; i < tpl.steps.minRows; i++) addStep(host, tpl);

  const set = (k, v) => {
    const el = host.querySelector('[data-j="' + k + '"]');
    if (el && v != null) el.value = v;
  };
  set('jsaTech', u.name);
  set('preparedBy', u.name);
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  set('jsaDate', now.toISOString().slice(0, 16));
  tally(host, tpl);
}

export function addStep(host, tpl) {
  const box = host.querySelector('#steps');
  if (!box) return;
  const n = box.children.length + 1;
  const row = document.createElement('div');
  row.className = 'steprow';
  row.dataset.step = String(n);
  row.innerHTML = '<div class="stepno">Step <b>' + n + '</b>'
    + '<button type="button" class="mini del" data-delstep="1">Remove</button></div>'
    + '<div class="fgrid">'
    + tpl.steps.columns.map(c => '<div class="fld"><label>' + esc(c.label) + '</label>'
        + '<textarea rows="2" data-col="' + esc(c.key) + '" placeholder="'
        + esc(c.placeholder) + '"></textarea></div>').join('')
    + '</div>';
  box.appendChild(row);
  renumber(host);
}

function renumber(host) {
  const box = host.querySelector('#steps');
  if (!box) return;
  [...box.children].forEach((r, i) => {
    r.dataset.step = String(i + 1);
    const b = r.querySelector('.stepno b');
    if (b) b.textContent = String(i + 1);
    const d = r.querySelector('[data-delstep]');
    if (d) d.hidden = box.children.length <= 1;
  });
}

/* Which permits are open, read off the hazard buttons rather than kept in a
   variable - the buttons are the truth, and a second copy of the truth is a
   second thing that can be wrong. */
export function openPermits(host, tpl) {
  const out = [];
  tpl.hazards.forEach(hz => {
    if (!hz.permit) return;
    const row = host.querySelector('[data-haz="' + hz.key + '"]');
    const on = row && row.querySelector('.res.on');
    if (on && on.dataset.result === 'yes') out.push(hz.permit);
  });
  return out;
}

export function sync(host, tpl) {
  const open = openPermits(host, tpl);
  host.querySelectorAll('[data-permit]').forEach(p => {
    p.hidden = open.indexOf(p.dataset.permit) < 0;
  });
  const loto = host.querySelector('[data-j="lotoRequired"]');
  const det = host.querySelector('#lotoDetail');
  if (loto && det) det.hidden = loto.value !== 'yes';
  tally(host, tpl);
}

export function tally(host, tpl) {
  const rows = host.querySelectorAll('[data-haz]');
  let marked = 0, yes = 0;
  rows.forEach(r => {
    const on = r.querySelector('.res.on');
    if (on) { marked++; if (on.dataset.result === 'yes') yes++; }
  });
  const el = host.querySelector('#jtally');
  if (!el) return;
  const open = openPermits(host, tpl);
  el.textContent = marked + ' of ' + rows.length + ' categories answered'
    + (yes ? ' · ' + yes + ' hazard' + (yes === 1 ? '' : 's') + ' present' : '')
    + (open.length ? ' · ' + open.length + ' permit'
        + (open.length === 1 ? '' : 's') + ' required' : '');
  el.className = 'tally' + (marked === rows.length ? ' done' : '');
}

/* The form's own click handling. Returned true means "handled" - app.js
   stops there rather than also treating it as navigation. */
export function formClick(e, host, tpl) {
  const res = e.target.closest('.res');
  if (res && host.contains(res)) {
    const item = res.closest('.item');
    item.querySelectorAll('.res').forEach(b => b.classList.toggle('on', b === res));
    const note = item.querySelector('textarea');
    const isYes = res.dataset.result === 'yes';
    if (note) {
      note.hidden = !isYes && !note.value.trim();
      note.rows = isYes ? 2 : 1;
      if (isYes) note.focus();
    }
    sync(host, tpl);
    return true;
  }
  if (e.target.id === 'jaddstep') { addStep(host, tpl); return true; }
  const del = e.target.closest('[data-delstep]');
  if (del && host.contains(del)) {
    const box = host.querySelector('#steps');
    if (box.children.length > 1) { del.closest('.steprow').remove(); renumber(host); }
    return true;
  }
  return false;
}

/* ---------- reading the form ----------------------------------------- */

export function collect(host, tpl, ctx) {
  /* Every refusal carries the field it is about, so the form can take the
     person TO the thing rather than printing a list at the bottom and
     leaving them to hunt. The first one wins - fix that, press again, and
     it walks you down. */
  const problems = [];
  let at = null;
  const bad = (text, sel) => { problems.push(text); if (!at && sel) at = sel; };
  const u = auth.currentUser();
  const val = k => {
    const el = host.querySelector('[data-j="' + k + '"]');
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return String(el.value || '').trim();
  };

  /* ---- header ---- */
  tpl.header.forEach(f => {
    if (f.req && !val(f.key)) bad(f.label + ' is needed.', '[data-j="' + f.key + '"]');
  });

  /* ---- hazard review: every category answered, every YES explained ---- */
  const hazards = [];
  let unanswered = 0, firstUnanswered = null;
  tpl.hazards.forEach(hz => {
    const row = host.querySelector('[data-haz="' + hz.key + '"]');
    const on = row && row.querySelector('.res.on');
    const ta = row && row.querySelector('textarea');
    const r = on ? on.dataset.result : '';
    const ctl = ta ? ta.value.trim() : '';
    if (!r) { unanswered++; if (!firstUnanswered) firstUnanswered = hz.key; }
    if (r === 'yes' && !ctl) {
      bad('“' + hz.label + '” is a YES — write the controls for it.',
        '[data-haz="' + hz.key + '"] textarea');
    }
    hazards.push({ k: hz.key, label: hz.label, r, ctl,
      ...(hz.permit ? { permit: hz.permit } : {}) });
  });
  if (hazards.length !== tpl.hazards.length) {
    bad(`The form drew ${hazards.length} hazard categories but the `
      + `review has ${tpl.hazards.length}. Not filing a partial JSA.`);
  }
  if (unanswered) {
    bad(unanswered + ' hazard categor' + (unanswered === 1 ? 'y' : 'ies')
      + ' not answered. Every one needs NO, YES or N/A.',
      firstUnanswered ? '[data-haz="' + firstUnanswered + '"]' : null);
  }

  /* ---- the permits the review opened ---- */
  const open = openPermits(host, tpl);
  const permits = {};
  open.forEach(key => {
    const spec = tpl.permits[key];
    const fields = spec.fields.map(f => ({
      key: f.key, label: f.label, kind: f.kind, value: val(f.key),
      ...(f.kind === 'select'
        ? { shown: (f.options.find(o => o.value === val(f.key)) || {}).label || '' }
        : {}),
    }));
    spec.fields.forEach(f => {
      if (!f.req) return;
      const v = val(f.key);
      if (f.kind === 'check' ? v !== true : !v) {
        bad(spec.title + ' — ' + f.label
          + (f.kind === 'check' ? ' must be confirmed.' : ' is needed.'),
          '[data-j="' + f.key + '"]');
      }
    });
    permits[key] = { title: spec.title, fields };
  });

  /* ---- PPE ---- */
  const ppe = tpl.ppe.filter((_, i) =>
    (host.querySelector('[data-ppe="' + i + '"]') || {}).checked);

  /* ---- LOTO ---- */
  const lotoReq = val('lotoRequired') === 'yes';
  const sources = tpl.loto.sources.filter((_, i) =>
    (host.querySelector('[data-loto="' + i + '"]') || {}).checked);
  if (lotoReq) {
    tpl.loto.fields.filter(f => f.whenLoto && f.req).forEach(f => {
      const v = val(f.key);
      if (f.kind === 'check' ? v !== true : !v) {
        bad('LOTO — ' + f.label
          + (f.kind === 'check' ? ' must be confirmed.' : ' is needed.'),
          '[data-j="' + f.key + '"]');
      }
    });
    if (!sources.length) {
      bad('LOTO is required — say which energy sources were isolated.',
        '[data-loto="0"]');
    }
  }

  /* ---- job steps: at least one, and a step is all three columns ---- */
  const steps = [];
  host.querySelectorAll('.steprow').forEach(r => {
    const g = {};
    tpl.steps.columns.forEach(c => {
      const t = r.querySelector('[data-col="' + c.key + '"]');
      g[c.key] = t ? t.value.trim() : '';
    });
    const any = tpl.steps.columns.some(c => g[c.key]);
    const all = tpl.steps.columns.every(c => g[c.key]);
    if (any && !all) {
      bad('Step ' + r.dataset.step + ' is half filled in — a step needs '
        + 'the work, the hazard and the control.',
        '.steprow[data-step="' + r.dataset.step + '"]');
    }
    if (all) steps.push(g);
  });
  if (!steps.length) {
    bad('Break the job into at least one step, with its hazard and control.',
      '.steprow[data-step="1"] [data-col="desc"]');
  }

  /* ---- reflection and sign-off ---- */
  if (tpl.reflection.req && !val(tpl.reflection.key)) {
    bad('Answer the daily risk reflection — ' + tpl.reflection.label,
      '[data-j="' + tpl.reflection.key + '"]');
  }
  tpl.signoff.forEach(f => {
    if (!f.req) return;
    const v = val(f.key);
    if (f.kind === 'check' ? v !== true : !v) {
      bad(f.kind === 'check'
        ? 'Confirm the crew acknowledgement before filing.'
        : f.label + ' is needed.', '[data-j="' + f.key + '"]');
    }
  });

  if (problems.length) return { problems, at };

  const unitRaw = val('jsaEquipment');
  const match = (ctx.equipment || []).find(e =>
    e.unit && unitRaw && String(e.unit).toUpperCase() === unitRaw.toUpperCase());

  const rec = {
    uid: u.uid, byName: u.name, byEmail: u.email || '',
    form: 'jsa', formVersion: tpl.version,
    tech: val('jsaTech'),
    jsaDate: new Date(val('jsaDate')).toISOString(),
    site: val('jsaSite'),
    equipment: unitRaw,
    unitId: match ? match.id : '',
    serial: match ? (match.serial || '') : '',
    customer: match ? (match.customer || '') : '',
    customerName: match ? (match.customerName || '') : '',
    taskDesc: val('jsaTaskDesc'),
    crew: val('jsaCrew'),
    hazards,
    hazardsYes: hazards.filter(x => x.r === 'yes').length,
    permitsOpen: open,
    permits,
    ppe,
    loto: {
      required: lotoReq ? 'yes' : 'no',
      zeroEnergy: val('lotoZeroEnergy') === true,
      appliedBy: val('lotoAppliedBy'),
      lockCount: val('lotoLockCount'),
      sources,
    },
    steps,
    mostDangerousTask: val('mostDangerousTask'),
    preparedBy: val('preparedBy'),
    supervisorReview: val('supervisorReview'),
    crewAck: val('crewAckCheck') === true,
    hold: false, holdReason: '',
    retentionDays: CONFIG.retention.jsa.days,
  };
  rec.expiresAt = expiryFor(rec, rec.retentionDays);
  return { rec };
}

/* ---------- storage --------------------------------------------------- */

const DEMO_KEY = 'bsds.jsas';
const demoAll = () => {
  try { return JSON.parse(sessionStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; }
};
const demoPut = rows => {
  try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(rows)); } catch (e) {}
};

export async function save(rec) {
  const u = auth.currentUser();
  if (u && u.demo) {
    const rows = demoAll();
    const id = 'demo-' + Date.now();
    rows.unshift({ id, ...rec, createdAt: new Date().toISOString(),
      expiresAt: rec.expiresAt ? rec.expiresAt.toISOString() : null });
    demoPut(rows);
    return id;
  }
  const { d, m } = await auth.db();
  const ref = await m.addDoc(m.collection(d, 'jsas'), {
    ...rec,
    jsaDate: m.Timestamp.fromDate(new Date(rec.jsaDate)),
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
  const parts = [m.collection(d, 'jsas')];
  if (u.role === 'tech') parts.push(m.where('uid', '==', u.uid));
  parts.push(m.orderBy('jsaDate', 'desc'), m.limit(o.limit || 200));
  const snap = await m.getDocs(m.query(...parts));
  return snap.docs.map(x => ({ id: x.id, ...x.data() }));
}

export async function get(id) {
  const u = auth.currentUser();
  if (u && u.demo) return demoAll().find(r => r.id === id) || null;
  const { d, m } = await auth.db();
  const snap = await m.getDoc(m.doc(d, 'jsas', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setHold(id, on, reason) {
  const rec = await get(id);
  if (!rec) throw new Error('no such JSA');
  const u = auth.currentUser();
  const exp = expiryFor({ ...rec, hold: !!on },
    rec.retentionDays || CONFIG.retention.jsa.days);
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
  await m.updateDoc(m.doc(d, 'jsas', id), {
    ...patch, expiresAt: exp ? m.Timestamp.fromDate(exp) : null,
  });
}

/* ---------- a stored JSA, drawn as the form --------------------------- */

export function drawRecord(host, rec, opts) {
  const o = opts || {};
  const note = retentionNote(rec);
  const when = asDate(rec.jsaDate);
  const h = ['<div class="wrap"><div class="sheet">'];

  h.push('<div class="shead"><div><b>Job Safety Analysis</b>',
    '<span>Broken Spoke Drilling Solutions</span></div>',
    '<div class="stamp ', rec.permitsOpen && rec.permitsOpen.length ? 'fail' : 'pass', '">',
    rec.permitsOpen && rec.permitsOpen.length
      ? esc(rec.permitsOpen.length) + ' PERMIT' + (rec.permitsOpen.length === 1 ? '' : 'S')
      : 'NO PERMIT',
    '</div></div>');

  const row = (k, v) => '<div><span>' + esc(k) + '</span><b>'
    + (v ? esc(v) : '<i>not recorded</i>') + '</b></div>';
  h.push('<div class="sgrid">',
    row('Technician', rec.tech),
    row('Date', when ? when.toLocaleString() : ''),
    row('Mine site / location', rec.site),
    row('Equipment / asset', rec.equipment),
    row('Serial', rec.serial),
    row('Customer', rec.customerName),
    row('Crew present', rec.crew),
    '</div>');

  h.push('<h3 class="ssec">Task</h3><div class="sbody">',
    rec.taskDesc ? esc(rec.taskDesc) : '<i>not recorded</i>', '</div>');

  /* ---- hazard review, all twelve, as answered ---- */
  h.push('<h3 class="ssec">MSHA hazard category review</h3><div class="slines">');
  (rec.hazards || []).forEach(x => {
    h.push('<div class="sline ', esc(x.r || 'blank'), '">',
      '<span class="sres">', esc(STATUS_LABEL[x.r] || '—'), '</span>',
      '<span class="sitem">', esc(x.label),
      x.ctl ? '<em>' + esc(x.ctl) + '</em>' : '',
      '</span></div>');
  });
  h.push('</div>');

  /* ---- each permit that was opened ---- */
  (rec.permitsOpen || []).forEach(key => {
    const p = (rec.permits || {})[key];
    if (!p) return;
    h.push('<h3 class="ssec warn">', esc(p.title), '</h3><div class="sgrid">');
    let group = null;
    p.fields.forEach(f => {
      const v = f.kind === 'check'
        ? (f.value === true ? 'Yes' : 'NOT CONFIRMED')
        : (f.kind === 'select' ? (f.shown || f.value) : f.value);
      h.push('<div><span>', esc(f.label), '</span><b',
        f.kind === 'check' && f.value !== true ? ' class="bad"' : '', '>',
        v ? esc(v) : '<i>blank</i>', '</b></div>');
    });
    h.push('</div>');
  });

  /* ---- PPE ---- */
  h.push('<h3 class="ssec">Required PPE</h3><div class="sbody">',
    (rec.ppe && rec.ppe.length) ? esc(rec.ppe.join(' · ')) : '<i>none marked</i>',
    '</div>');

  /* ---- LOTO ---- */
  const l = rec.loto || {};
  h.push('<h3 class="ssec">Lockout / Tagout</h3>');
  if (l.required === 'yes') {
    h.push('<div class="sgrid">',
      row('Required', 'Yes'),
      row('Zero energy verified', l.zeroEnergy ? 'Yes' : 'NOT CONFIRMED'),
      row('Locks/tags applied by', l.appliedBy),
      row('Locks/tags applied', l.lockCount),
      '</div><div class="sbody">Energy sources isolated: ',
      (l.sources && l.sources.length) ? esc(l.sources.join(' · ')) : '<i>none listed</i>',
      '</div>');
  } else {
    h.push('<div class="sbody">Not required for this task.</div>');
  }

  /* ---- job steps ---- */
  h.push('<h3 class="ssec">Job steps, hazards &amp; controls</h3>');
  (rec.steps || []).forEach((s, i) => {
    h.push('<div class="sstep"><div class="n">', i + 1, '</div><div>',
      '<b>', esc(s.desc), '</b>',
      '<span><i>Hazards</i> ', esc(s.haz), '</span>',
      '<span><i>Controls</i> ', esc(s.ctl), '</span>',
      '</div></div>');
  });
  if (!(rec.steps || []).length) h.push('<div class="sbody"><i>no steps recorded</i></div>');

  h.push('<h3 class="ssec">Daily risk reflection</h3><div class="sbody">',
    rec.mostDangerousTask ? esc(rec.mostDangerousTask) : '<i>not answered</i>', '</div>');

  h.push('<div class="ssign">',
    '<div><span>Prepared by</span><b>', esc(rec.preparedBy || ''), '</b></div>',
    '<div><span>Supervisor review</span><b>',
    rec.supervisorReview ? esc(rec.supervisorReview) : '<i>none</i>', '</b></div>',
    '<div><span>Crew acknowledged</span><b', rec.crewAck ? '' : ' class="bad"', '>',
    rec.crewAck ? 'Yes' : 'NOT CONFIRMED', '</b></div>',
    '<div><span>Form</span><b>JSA v', esc(rec.formVersion), '</b></div>',
    '</div></div>');

  h.push('<div class="note', note.kind === 'hold' ? ' warn' : '',
    '"><b>Retention.</b> ', esc(note.text), '.</div>');

  if (o.canHold) {
    h.push('<h2 class="sec">Legal hold</h2>');
    h.push(rec.hold
      ? '<div class="note warn"><b>Held.</b> ' + esc(rec.holdReason || 'no reason given')
        + (rec.holdBy ? ' — set by ' + esc(rec.holdBy) : '')
        + '<br><button class="mini" data-hold="off">Release the hold</button></div>'
      : '<div class="note"><b>Not held.</b> Put a hold on this JSA if it is evidence '
        + 'in an incident, a citation contest or a customer dispute — a held record '
        + 'has no expiry date and cannot be deleted by the purge.'
        + '<br><input id="holdwhy" type="text" placeholder="Why (goes on the record)">'
        + '<button class="mini" data-hold="on">Put this on hold</button></div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

/* ---------- the log --------------------------------------------------- */

export function drawLog(host, rows, opts) {
  const o = opts || {};
  const h = ['<div class="wrap"><h1 class="pg">JSAs</h1>'];
  h.push('<p class="lede">', o.mine
    ? 'The JSAs you have filed. Techs see their own; the full log is office and owners.'
    : 'Every JSA on file. Click one to read it back as the form it was signed on.',
    '</p>');
  if (!rows.length) {
    h.push('<div class="empty">Nothing filed yet.</div></div>');
    host.innerHTML = h.join('');
    return;
  }
  if (!o.mine) {
    const permits = rows.filter(r => (r.permitsOpen || []).length).length;
    h.push('<div class="spec">',
      '<div><b>', rows.length, '</b><span>on file</span></div>',
      '<div', permits ? '' : ' class="missing"', '><b>', permits,
      '</b><span>with a permit</span></div>',
      '<div', rows.filter(r => r.hold).length ? '' : ' class="missing"', '><b>',
      rows.filter(r => r.hold).length, '</b><span>on hold</span></div>',
      '</div>');
  }
  h.push('<div class="find"><input id="jq" type="search" ',
    'placeholder="Task, site, equipment or crew" autocomplete="off"></div>');
  h.push('<div class="list" id="jrows">', rows.map(logRow).join(''), '</div></div>');
  host.innerHTML = h.join('');

  const q = host.querySelector('#jq');
  if (q) {
    q.addEventListener('input', () => {
      const t = q.value.trim().toUpperCase();
      const hit = !t ? rows : rows.filter(r =>
        [r.taskDesc, r.site, r.equipment, r.crew, r.tech]
          .join(' ').toUpperCase().includes(t));
      host.querySelector('#jrows').innerHTML = hit.length
        ? hit.map(logRow).join('')
        : '<div class="empty">Nothing matches.</div>';
    });
  }
}

function logRow(r) {
  const d = asDate(r.jsaDate);
  const np = (r.permitsOpen || []).length;
  return '<button class="row" data-jsa="' + esc(r.id) + '">'
    + '<span><span class="nm">'
    + esc((r.taskDesc || 'JSA').split('\n')[0].slice(0, 60))
    + '</span><span class="sub">'
    + [d ? d.toLocaleDateString() : '', r.tech, r.site, r.equipment]
        .filter(Boolean).map(esc).join(' · ')
    + '</span></span><span class="ct">'
    + (np ? '<b class="bad">' + np + ' permit' + (np === 1 ? '' : 's') + '</b>'
          : '<b class="good">' + (r.hazardsYes || 0) + ' hazard'
            + ((r.hazardsYes || 0) === 1 ? '' : 's') + '</b>')
    + (r.hold ? 'held' : '')
    + '</span></button>';
}
