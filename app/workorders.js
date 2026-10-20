/* Work order requests: a customer rings, somebody raises it, the office
 * builds it in Fullbay and the service order number comes back.
 *
 * This is the one form in the app that starts with a PHONE CALL rather than
 * a machine, which is why "who called" is a required field and the complaint
 * is free text. Nobody rings up with a part number; they ring up and say the
 * compressor is making a noise. Forcing that into a dropdown loses the only
 * thing the person on the phone actually said.
 *
 * Three states:
 *
 *   open       raised, nobody has built it in Fullbay yet
 *   built      it exists in Fullbay and carries a service order number
 *   cancelled  it is not happening
 *
 * The SO number is the whole point of the round trip. A tech rings in a
 * problem and then has no idea whether anything happened; putting the
 * number back on his own screen is what closes that loop without a phone
 * call in the other direction.
 *
 * A tech sees the work orders HE raised, plus any he has been assigned.
 * Assigning stamps the tech's id as well as his name, which is what makes
 * it land on his screen; office can read the roster to do that, which was
 * Mike's call in October 2026. If the roster cannot be read for any reason
 * the name is still recorded and the id is left empty - the assignment is
 * never silently lost, it just does not reach his phone until an owner
 * re-assigns it.
 */
import { CONFIG } from './config.js';
import * as auth from './auth.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STATUS = {
  open:      'Waiting to be built',
  built:     'Service order raised',
  cancelled: 'Cancelled',
};

const asDate = v => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

/* What a person must fill in. PO and the assigned tech are deliberately
   not on this list - the first is often not known when the call comes in,
   and the second is the office's job. */
export const FIELDS = [
  { key: 'customer',  label: 'Customer',    kind: 'customer', req: true },
  { key: 'location',  label: 'Location',    kind: 'text',     req: true,
    hint: 'Mine site, pit, yard — where the machine is.' },
  { key: 'unit',      label: 'Unit / serial', kind: 'unit',   req: true },
  { key: 'complaint', label: 'Complaint',   kind: 'textarea', req: true,
    hint: 'What they actually said. Their words beat your summary.' },
  { key: 'calledBy',  label: 'Who called',  kind: 'text',     req: true },
  { key: 'po',        label: 'PO number',   kind: 'text',
    hint: 'If they gave one. Often they have not.' },
  { key: 'assigned',  label: 'Assigned tech', kind: 'tech',
    hint: 'Leave it blank and the office will assign.' },
];

/* ---------- reading the form ----------------------------------------- */

export function collect(host, ctx) {
  const problems = [];
  let at = null;
  const bad = (t, sel) => { problems.push(t); if (!at && sel) at = sel; };
  const val = k => {
    const el = host.querySelector('[data-w="' + k + '"]');
    return el ? String(el.value || '').trim() : '';
  };

  FIELDS.forEach(f => {
    if (f.req && !val(f.key)) {
      bad(f.label + ' is needed.', '[data-w="' + f.key + '"]');
    }
  });
  if (problems.length) return { problems, at };

  const u = auth.currentUser();
  const unitRaw = val('unit');
  const machine = (ctx.equipment || []).find(e =>
    (e.unit && e.unit.toUpperCase() === unitRaw.toUpperCase())
    || (e.serial && e.serial.toUpperCase() === unitRaw.toUpperCase()));
  const custRaw = val('customer');
  const cust = (ctx.customers || []).find(c =>
    c.name.toUpperCase() === custRaw.toUpperCase());
  const tech = (ctx.people || []).find(p =>
    p.name && p.name.toUpperCase() === val('assigned').toUpperCase());

  return {
    rec: {
      uid: u.uid, byName: u.name, byEmail: u.email || '',
      customerName: cust ? cust.name : custRaw,
      customer: cust ? cust.id : '',
      location: val('location'),
      unit: unitRaw,
      unitId: machine ? machine.id : '',
      serial: machine ? (machine.serial || '') : '',
      complaint: val('complaint'),
      calledBy: val('calledBy'),
      po: val('po'),
      assigned: val('assigned'),
      assignedUid: tech ? tech.uid : '',
      status: 'open',
      soNumber: '',
    },
  };
}

/* ---------- storage --------------------------------------------------- */

const KEY = 'bsds.workOrders';
const localAll = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
};
const localPut = rows => {
  try { sessionStorage.setItem(KEY, JSON.stringify(rows)); } catch (e) {}
};

export async function save(rec) {
  const u = auth.currentUser();
  if (u && u.demo) {
    const rows = localAll();
    const id = 'demo-wo-' + Date.now() + '-' + rows.length;
    rows.unshift({ id, ...rec, createdAt: new Date().toISOString() });
    localPut(rows);
    return id;
  }
  const { d, m } = await auth.db();
  const ref = await m.addDoc(m.collection(d, 'workOrders'),
    { ...rec, createdAt: m.serverTimestamp() });
  return ref.id;
}

export async function list() {
  const u = auth.currentUser();
  if (u && u.demo) {
    const rows = localAll();
    return u.role === 'tech'
      ? rows.filter(r => r.uid === u.uid || r.assignedUid === u.uid)
      : rows;
  }
  const { d, m } = await auth.db();
  if (u.role === 'tech') {
    /* His own, plus anything an owner has put his name on. Two queries
       rather than one, because Firestore will not OR across two fields
       without an index per branch anyway. */
    const mine = m.getDocs(m.query(m.collection(d, 'workOrders'),
      m.where('uid', '==', u.uid), m.orderBy('createdAt', 'desc'), m.limit(100)));
    const his = m.getDocs(m.query(m.collection(d, 'workOrders'),
      m.where('assignedUid', '==', u.uid), m.orderBy('createdAt', 'desc'), m.limit(100)));
    const [a, b] = await Promise.all([mine, his]);
    const seen = new Map();
    [...a.docs, ...b.docs].forEach(x => seen.set(x.id, { id: x.id, ...x.data() }));
    return [...seen.values()].sort((p, q) =>
      (asDate(q.createdAt) || 0) - (asDate(p.createdAt) || 0));
  }
  const snap = await m.getDocs(m.query(m.collection(d, 'workOrders'),
    m.orderBy('createdAt', 'desc'), m.limit(300)));
  return snap.docs.map(x => ({ id: x.id, ...x.data() }));
}

export async function get(id) {
  const u = auth.currentUser();
  if (u && u.demo) return localAll().find(r => r.id === id) || null;
  const { d, m } = await auth.db();
  const s = await m.getDoc(m.doc(d, 'workOrders', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* Building it in Fullbay is somebody leaving the app, doing a thing, and
   coming back with a number. All this records is the number. */
export async function markBuilt(id, soNumber) {
  const so = String(soNumber || '').trim();
  if (!so) throw new Error('Put the service order number on it.');
  const u = auth.currentUser();
  const patch = { status: 'built', soNumber: so, builtBy: u.name,
    builtAt: new Date().toISOString() };
  if (u.demo) {
    localPut(localAll().map(r => r.id === id ? { ...r, ...patch } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'workOrders', id),
    { ...patch, builtAt: m.serverTimestamp() });
}

export async function assign(id, name, people) {
  const who = String(name || '').trim();
  const match = (people || []).find(p =>
    p.name && p.name.toUpperCase() === who.toUpperCase());
  const u = auth.currentUser();
  const patch = { assigned: who, assignedUid: match ? match.uid : '' };
  if (u.demo) {
    localPut(localAll().map(r => r.id === id ? { ...r, ...patch } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'workOrders', id), patch);
}

export async function cancel(id) {
  const u = auth.currentUser();
  if (u.demo) {
    localPut(localAll().map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'workOrders', id), { status: 'cancelled' });
}

/* ---------- the form --------------------------------------------------- */

function control(f, ctx) {
  const id = 'w_' + f.key;
  const lab = '<label for="' + id + '">' + esc(f.label) + '</label>';
  const common = 'id="' + id + '" data-w="' + esc(f.key) + '" autocomplete="off"';
  const hint = f.hint ? '<p class="hint">' + esc(f.hint) + '</p>' : '';
  if (f.kind === 'textarea') {
    return lab + '<textarea ' + common + ' rows="3"></textarea>' + hint;
  }
  if (f.kind === 'customer') {
    const list = (ctx.customers || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return lab + '<input ' + common + ' list="wcusts" spellcheck="false">'
      + '<datalist id="wcusts">'
      + list.map(c => '<option value="' + esc(c.name) + '"></option>').join('')
      + '</datalist>' + hint;
  }
  if (f.kind === 'unit') {
    const list = (ctx.equipment || []).filter(e => !e.retired).slice()
      .sort((a, b) => String(a.unit).localeCompare(String(b.unit)));
    return lab + '<input ' + common + ' list="wunits" spellcheck="false" '
      + 'placeholder="Unit number or serial">'
      + '<datalist id="wunits">'
      + list.map(e => '<option value="' + esc(e.unit) + '">'
          + esc([e.customerName, e.serial].filter(Boolean).join(' · ')) + '</option>').join('')
      + '</datalist>' + hint;
  }
  if (f.kind === 'tech') {
    const list = (ctx.people || []).filter(p => p.role === 'tech');
    return lab + '<input ' + common + (list.length ? ' list="wtechs"' : '') + '>'
      + (list.length ? '<datalist id="wtechs">'
          + list.map(p => '<option value="' + esc(p.name) + '"></option>').join('')
          + '</datalist>' : '')
      + hint;
  }
  return lab + '<input ' + common + ' type="text">' + hint;
}

export function drawForm(host, ctx) {
  const h = ['<div class="wrap"><h1 class="pg">Work order request</h1>',
    '<p class="lede">Somebody rang in a problem. Get it down while it is fresh — ',
    'the office builds it in Fullbay and the service order number comes back here.</p>',
    '<form class="pform" id="wform" novalidate><div class="fgrid">'];
  FIELDS.forEach(f => h.push('<div class="fld',
    (f.kind === 'textarea' || f.kind === 'unit') ? ' wide' : '', '">',
    control(f, ctx), '</div>'));
  h.push('</div><p class="msg" id="wmsg"></p>',
    '<button type="button" class="btn primary" id="wsend">Send the request</button>',
    '</form>');
  h.push('<div class="note"><b>What happens next.</b> It lands on the work order ',
    'list for Mike, Stew and Jazmine. When it is built in Fullbay the service ',
    'order number appears on this request, so you do not have to ring anybody ',
    'to find out whether it happened.</div></div>');
  host.innerHTML = h.join('');
}

/* ---------- lists and the record -------------------------------------- */

const pill = st => '<span class="upill ' + (st === 'built' ? 'stock'
  : st === 'cancelled' ? 'stock' : 'soon') + '">'
  + esc(st === 'built' ? 'SO raised' : st === 'cancelled' ? 'Cancelled' : 'Open')
  + '</span>';

export function row(r) {
  const d = asDate(r.createdAt);
  return '<button class="row" data-wo="' + esc(r.id) + '">'
    + '<span><span class="nm">' + pill(r.status) + ' ' + esc(r.customerName || 'No customer')
    + '</span><span class="sub">'
    + [d ? d.toLocaleDateString() : '', r.unit, r.location, r.assigned ? 'to ' + r.assigned : '']
        .filter(Boolean).map(esc).join(' · ')
    + '</span></span><span class="ct">'
    + (r.soNumber ? '<b class="good">SO ' + esc(r.soNumber) + '</b>' : '')
    + '</span></button>';
}

export function drawList(host, rows, opts) {
  const o = opts || {};
  const open = rows.filter(r => r.status === 'open');
  const rest = rows.filter(r => r.status !== 'open');
  const h = ['<div class="wrap"><h1 class="pg">Work orders</h1>',
    '<p class="lede">', o.mine
      ? 'What you have rung in, and the service order number once it is built.'
      : 'Called in and waiting to be built in Fullbay.', '</p>'];
  if (!o.mine) {
    h.push('<div class="spec">',
      '<div', open.length ? ' class="bad"' : ' class="missing"', '><b>', open.length,
      '</b><span>to build</span></div>',
      '<div><b>', rows.filter(r => r.status === 'built').length,
      '</b><span>built</span></div></div>');
  }
  if (!rows.length) {
    h.push('<div class="empty">Nothing yet.</div></div>');
    host.innerHTML = h.join('');
    return;
  }
  if (open.length) {
    h.push('<h2 class="sec">', o.mine ? 'Waiting' : 'To build', '</h2><div class="list">',
      open.map(row).join(''), '</div>');
  }
  if (rest.length) {
    h.push('<h2 class="sec">Done</h2><div class="list">', rest.map(row).join(''), '</div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawRecord(host, r, opts) {
  const o = opts || {};
  const d = asDate(r.createdAt), b = asDate(r.builtAt);
  const fb = (CONFIG.tools.fullbay || {}).url || 'https://app.fullbay.com';
  const h = ['<div class="wrap"><div class="sheet">',
    '<div class="shead"><div><b>Work order request</b>',
    '<span>Broken Spoke Drilling Solutions</span></div>',
    '<div class="stamp ', r.status === 'built' ? 'pass' : 'fail', '">',
    r.soNumber ? 'SO ' + esc(r.soNumber) : (r.status === 'cancelled' ? 'CANCELLED' : 'OPEN'),
    '</div></div>',
    '<div class="sgrid">',
    '<div><span>Customer</span><b>', esc(r.customerName || '—'), '</b></div>',
    '<div><span>Location</span><b>', esc(r.location || '—'), '</b></div>',
    '<div><span>Unit</span><b>', esc(r.unit || '—'), '</b></div>',
    '<div><span>Serial</span><b>', r.serial ? esc(r.serial) : '<i>not matched</i>', '</b></div>',
    '<div><span>Who called</span><b>', esc(r.calledBy || '—'), '</b></div>',
    '<div><span>PO</span><b>', r.po ? esc(r.po) : '<i>none given</i>', '</b></div>',
    '<div><span>Assigned</span><b>', r.assigned ? esc(r.assigned)
      : '<i>not yet</i>', '</b></div>',
    '<div><span>Raised by</span><b>', esc(r.byName || ''), '</b></div>',
    '<div><span>When</span><b>', d ? esc(d.toLocaleString()) : '', '</b></div>',
    '</div>',
    '<h3 class="ssec">Complaint</h3><div class="sbody">',
    r.complaint ? esc(r.complaint) : '<i>nothing written</i>', '</div>',
    '</div>'];

  if (r.status === 'built') {
    h.push('<div class="note"><b>Service order ', esc(r.soNumber), '.</b> Built',
      r.builtBy ? ' by ' + esc(r.builtBy) : '',
      b ? ' on ' + esc(b.toLocaleDateString()) : '', '.</div>');
  }

  h.push('<div class="bar"><a class="mini" href="', esc(fb),
    '" target="_blank" rel="noopener">Open Fullbay</a></div>');

  if (o.canManage && r.status === 'open') {
    h.push('<h2 class="sec">Once it is built</h2><div class="panel">',
      '<div class="fgrid"><div class="fld"><label for="w_so">Service order number</label>',
      '<input id="w_so" type="text" autocomplete="off"></div>',
      '<div class="fld"><label for="w_assign">Assign a tech</label>',
      '<input id="w_assign" type="text" autocomplete="off"',
      (o.people || []).length ? ' list="wtechs2"' : '', ' value="', esc(r.assigned || ''), '">',
      (o.people || []).length ? '<datalist id="wtechs2">'
        + o.people.filter(p => p.role === 'tech')
          .map(p => '<option value="' + esc(p.name) + '"></option>').join('')
        + '</datalist>' : '',
      '</div></div>',
      '<p class="msg" id="womsg"></p>',
      '<button type="button" class="btn primary" data-built="', esc(r.id),
      '">Mark it built</button>',
      '<button type="button" class="mini" data-woassign="', esc(r.id),
      '">Save the assignment</button>',
      '<p class="hint">Marking it built puts the service order number back on ',
      'the request, where whoever rang it in can see it.</p>',
      '</div>',
      '<div class="bar"><button class="mini" data-wocancel="', esc(r.id),
      '">Cancel this request</button></div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}
