/* Parts: a tech asks, the office orders, somebody receives it.
 *
 * Three states and nothing clever:
 *
 *   open      a tech has asked for it, nobody has bought it yet
 *   ordered   it is on an order with a vendor and a PO against it
 *   received  it turned up
 *
 * The request is the tech's record and the order is the office's, and they
 * are kept apart on purpose. A request says "the rig needs this"; an order
 * says "we bought this, from them, on that PO". Collapsing the two is how
 * you end up unable to answer either "what is this rig waiting on" or "what
 * did we actually buy last month".
 *
 * Two decisions worth knowing about:
 *
 * - A LINE WITH NO PART NUMBER IS ALLOWED, and flagged. Half the time the
 *   tech knows what the thing is and not what it is called. Forcing a
 *   number out of him produces a guessed number, which is worse than a
 *   description and a lookup. The queue marks those so the office knows
 *   there is a number to find before anybody orders.
 *
 * - DOWN IS NOT A PRIORITY, IT IS A FACT. A rig that is not drilling is a
 *   different kind of request from a shelf restock, so it sorts first and
 *   says so in colour, and nothing else competes with it.
 *
 * Once a request has been ordered the tech can no longer edit it - it has
 * stopped being a request and started being a record of what was bought.
 * That is enforced in firestore.rules, not just here.
 */
import * as auth from './auth.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const URGENCY = [
  { value: 'down',  label: 'Down',  note: 'Rig is down, not drilling' },
  { value: 'soon',  label: 'Soon',  note: 'Needed in the next few days' },
  { value: 'stock', label: 'Stock', note: 'Restocking the shelf' },
];
const URG = Object.fromEntries(URGENCY.map(u => [u.value, u]));

export const STATUS = {
  open:      'Needs ordering',
  ordered:   'On order',
  received:  'Received',
  cancelled: 'Cancelled',
};

const RANK = { down: 0, soon: 1, stock: 2 };

const asDate = v => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

export const lineNeedsLookup = l => !String(l.pn || '').trim();
export const needsLookup = r => (r.lines || []).some(lineNeedsLookup);

export function sortQueue(rows) {
  return rows.slice().sort((a, b) => {
    const r = (RANK[a.urgency] ?? 9) - (RANK[b.urgency] ?? 9);
    if (r) return r;
    const da = asDate(a.createdAt), db = asDate(b.createdAt);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);   // oldest first
  });
}

/* ---------- building a request --------------------------------------- */

export function collect(host, ctx) {
  const problems = [];
  const val = k => {
    const el = host.querySelector('[data-p="' + k + '"]');
    return el ? String(el.value || '').trim() : '';
  };
  const on = host.querySelector('.res.on');
  const urgency = on ? on.dataset.result : '';
  if (!urgency) problems.push('Say how urgent it is.');

  const unit = val('unit');
  if (!unit) problems.push('Which machine is it for?');

  const lines = [];
  host.querySelectorAll('.partrow').forEach(r => {
    const g = {};
    ['pn', 'qty', 'desc', 'vendor'].forEach(k => {
      const el = r.querySelector('[data-col="' + k + '"]');
      g[k] = el ? el.value.trim() : '';
    });
    const any = g.pn || g.desc || g.vendor || g.qty;
    if (!any) return;
    if (!g.pn && !g.desc) {
      problems.push('Line ' + r.dataset.part + ' needs a part number or a description '
        + '— one of the two.');
      return;
    }
    const q = Number(g.qty);
    if (!g.qty || !Number.isFinite(q) || q <= 0) {
      problems.push('Line ' + r.dataset.part + ' needs a quantity.');
      return;
    }
    lines.push({ pn: g.pn, qty: q, desc: g.desc, vendor: g.vendor });
  });
  if (!lines.length) problems.push('Put at least one part on it.');

  if (problems.length) return { problems };

  const u = auth.currentUser();
  const match = (ctx.equipment || []).find(e =>
    e.unit && String(e.unit).toUpperCase() === unit.toUpperCase());
  return {
    rec: {
      uid: u.uid, byName: u.name, byEmail: u.email || '',
      unit,
      unitId: match ? match.id : '',
      serial: match ? (match.serial || '') : '',
      customer: match ? (match.customer || '') : '',
      customerName: match ? (match.customerName || '') : '',
      workOrder: val('workOrder'),
      urgency,
      note: val('note'),
      lines,
      status: 'open',
      orderId: '',
    },
  };
}

/* ---------- storage --------------------------------------------------- */

const K_REQ = 'bsds.partsRequests', K_ORD = 'bsds.partsOrders';
const localAll = k => {
  try { return JSON.parse(sessionStorage.getItem(k) || '[]'); } catch (e) { return []; }
};
const localPut = (k, rows) => {
  try { sessionStorage.setItem(k, JSON.stringify(rows)); } catch (e) {}
};

export async function save(rec) {
  const u = auth.currentUser();
  if (u && u.demo) {
    const rows = localAll(K_REQ);
    const id = 'demo-' + Date.now() + '-' + rows.length;
    rows.unshift({ id, ...rec, createdAt: new Date().toISOString() });
    localPut(K_REQ, rows);
    return id;
  }
  const { d, m } = await auth.db();
  const ref = await m.addDoc(m.collection(d, 'partsRequests'),
    { ...rec, createdAt: m.serverTimestamp() });
  return ref.id;
}

export async function listRequests() {
  const u = auth.currentUser();
  if (u && u.demo) {
    const rows = localAll(K_REQ);
    return u.role === 'tech' ? rows.filter(r => r.uid === u.uid) : rows;
  }
  const { d, m } = await auth.db();
  const parts = [m.collection(d, 'partsRequests')];
  if (u.role === 'tech') parts.push(m.where('uid', '==', u.uid));
  parts.push(m.orderBy('createdAt', 'desc'), m.limit(300));
  const snap = await m.getDocs(m.query(...parts));
  return snap.docs.map(x => ({ id: x.id, ...x.data() }));
}

export async function getRequest(id) {
  const u = auth.currentUser();
  if (u && u.demo) return localAll(K_REQ).find(r => r.id === id) || null;
  const { d, m } = await auth.db();
  const s = await m.getDoc(m.doc(d, 'partsRequests', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function listOrders() {
  const u = auth.currentUser();
  if (u && u.demo) return localAll(K_ORD);
  const { d, m } = await auth.db();
  const snap = await m.getDocs(m.query(m.collection(d, 'partsOrders'),
    m.orderBy('placedAt', 'desc'), m.limit(200)));
  return snap.docs.map(x => ({ id: x.id, ...x.data() }));
}

export async function getOrder(id) {
  const u = auth.currentUser();
  if (u && u.demo) return localAll(K_ORD).find(r => r.id === id) || null;
  const { d, m } = await auth.db();
  const s = await m.getDoc(m.doc(d, 'partsOrders', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* Turning requests into an order. The order carries a SNAPSHOT of the lines
   as they were when it was placed, so that later edits to a request - or a
   request being cancelled - cannot quietly rewrite what the record says was
   bought. */
export async function placeOrder({ vendor, po, expected, note }, requests) {
  if (!String(vendor || '').trim()) throw new Error('Say who it is being ordered from.');
  if (!requests.length) throw new Error('Pick at least one request.');
  const u = auth.currentUser();
  const now = new Date().toISOString();
  const lines = requests.flatMap(r => (r.lines || []).map(l => ({
    ...l, requestId: r.id, unit: r.unit, customerName: r.customerName || '',
  })));
  const order = {
    vendor: String(vendor).trim(),
    po: String(po || '').trim(),
    expected: String(expected || '').trim(),
    note: String(note || '').trim(),
    requestIds: requests.map(r => r.id),
    lines,
    status: 'placed',
    placedBy: u.name,
    placedAt: now,
  };
  if (u.demo) {
    const rows = localAll(K_ORD);
    const id = 'demo-ord-' + Date.now();
    rows.unshift({ id, ...order });
    localPut(K_ORD, rows);
    const reqs = localAll(K_REQ).map(r => requests.some(x => x.id === r.id)
      ? { ...r, status: 'ordered', orderId: id, orderedAt: now } : r);
    localPut(K_REQ, reqs);
    return id;
  }
  const { d, m } = await auth.db();
  const ref = await m.addDoc(m.collection(d, 'partsOrders'),
    { ...order, placedAt: m.serverTimestamp() });
  await Promise.all(requests.map(r => m.updateDoc(m.doc(d, 'partsRequests', r.id),
    { status: 'ordered', orderId: ref.id, orderedAt: m.serverTimestamp() })));
  return ref.id;
}

export async function receiveOrder(id) {
  const u = auth.currentUser();
  const now = new Date().toISOString();
  const order = await getOrder(id);
  if (!order) throw new Error('no such order');
  if (u.demo) {
    localPut(K_ORD, localAll(K_ORD).map(o => o.id === id
      ? { ...o, status: 'received', receivedAt: now, receivedBy: u.name } : o));
    localPut(K_REQ, localAll(K_REQ).map(r => (order.requestIds || []).includes(r.id)
      ? { ...r, status: 'received', receivedAt: now } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'partsOrders', id),
    { status: 'received', receivedAt: m.serverTimestamp(), receivedBy: u.name });
  await Promise.all((order.requestIds || []).map(rid =>
    m.updateDoc(m.doc(d, 'partsRequests', rid),
      { status: 'received', receivedAt: m.serverTimestamp() })));
}

export async function cancelRequest(id) {
  const u = auth.currentUser();
  if (u.demo) {
    localPut(K_REQ, localAll(K_REQ).map(r => r.id === id
      ? { ...r, status: 'cancelled' } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'partsRequests', id), { status: 'cancelled' });
}

/* ---------- the request form ------------------------------------------ */

export function drawForm(host, ctx) {
  const u = auth.currentUser();
  const units = (ctx.equipment || []).filter(e => !e.retired).slice()
    .sort((a, b) => String(a.unit).localeCompare(String(b.unit)));
  const h = ['<div class="wrap"><h1 class="pg">Order parts</h1>',
    '<p class="lede">What the machine needs. If you know the number put it in; if you ',
    'only know what the thing is, say that — the office will find the number.</p>',
    '<form class="pform" id="pform" novalidate>',
    '<h2 class="sec">The job</h2><div class="fgrid">',
    '<div class="fld"><label for="p_unit">Machine</label>',
    '<input id="p_unit" data-p="unit" list="punits" autocomplete="off" ',
    'spellcheck="false" placeholder="Unit number">',
    '<datalist id="punits">',
    units.map(e => '<option value="' + esc(e.unit) + '">'
      + esc([e.customerName, e.model].filter(Boolean).join(' · ')) + '</option>').join(''),
    '</datalist></div>',
    '<div class="fld"><label for="p_wo">Work order</label>',
    '<input id="p_wo" data-p="workOrder" type="text" autocomplete="off"></div>',
    '</div>'];

  h.push('<h2 class="sec">How urgent</h2><div class="urg">');
  URGENCY.forEach(x => h.push('<button type="button" class="res" data-result="',
    esc(x.value), '"><b>', esc(x.label), '</b><span>', esc(x.note), '</span></button>'));
  h.push('</div>');

  h.push('<h2 class="sec">Parts</h2><div id="partlines"></div>',
    '<button type="button" class="mini" id="paddline">+ Add another part</button>');

  h.push('<h2 class="sec">Anything else</h2><div class="fgrid">',
    '<div class="fld wide"><label for="p_note">Note</label>',
    '<textarea id="p_note" data-p="note" rows="2"></textarea></div></div>');

  h.push('<p class="msg" id="pmsg2"></p>',
    '<button type="button" class="btn primary" id="psend">Send the request</button>',
    '</form>');
  h.push('<div class="note"><b>What happens next.</b> It lands on the parts list for ',
    'Mike, Stew and Jazmine. When it goes on an order you will see it move to ',
    '<b>On order</b>, and to <b>Received</b> when it turns up — you do not have to ',
    'chase anybody to find out.</div></div>');
  host.innerHTML = h.join('');
  addLine(host);
  addLine(host);
  const who = host.querySelector('[data-p="byName"]');
  if (who) who.value = u.name;
}

export function addLine(host) {
  const box = host.querySelector('#partlines');
  if (!box) return;
  const n = box.children.length + 1;
  const row = document.createElement('div');
  row.className = 'partrow';
  row.dataset.part = String(n);
  row.innerHTML = '<div class="pn">Part <b>' + n + '</b>'
    + '<button type="button" class="mini del" data-delpart="1">Remove</button></div>'
    + '<div class="fgrid">'
    + '<div class="fld"><label>Part number</label>'
    + '<input data-col="pn" type="text" autocomplete="off" spellcheck="false" '
    + 'placeholder="e.g. R32-BIT-51"></div>'
    + '<div class="fld"><label>Quantity</label>'
    + '<input data-col="qty" type="number" min="1" inputmode="numeric" placeholder="e.g. 2"></div>'
    + '<div class="fld wide"><label>What it is</label>'
    + '<input data-col="desc" type="text" autocomplete="off" '
    + 'placeholder="e.g. 51mm button bit"></div>'
    + '<div class="fld"><label>Vendor, if you know</label>'
    + '<input data-col="vendor" type="text" autocomplete="off" placeholder="e.g. Mincon Inc."></div>'
    + '</div>';
  box.appendChild(row);
  renumber(host);
}

function renumber(host) {
  const box = host.querySelector('#partlines');
  if (!box) return;
  [...box.children].forEach((r, i) => {
    r.dataset.part = String(i + 1);
    const b = r.querySelector('.pn b');
    if (b) b.textContent = String(i + 1);
    const d = r.querySelector('[data-delpart]');
    if (d) d.hidden = box.children.length <= 1;
  });
}

export function formClick(e, host) {
  const res = e.target.closest('.res');
  if (res && host.contains(res)) {
    host.querySelectorAll('.urg .res').forEach(b => b.classList.toggle('on', b === res));
    return true;
  }
  if (e.target.id === 'paddline') { addLine(host); return true; }
  const del = e.target.closest('[data-delpart]');
  if (del && host.contains(del)) {
    const box = host.querySelector('#partlines');
    if (box.children.length > 1) { del.closest('.partrow').remove(); renumber(host); }
    return true;
  }
  return false;
}

/* ---------- drawing requests and orders ------------------------------- */

const urgPill = u => '<span class="upill ' + esc(u) + '">'
  + esc((URG[u] || {}).label || '—') + '</span>';

const stamp = (r) => {
  const d = asDate(r.createdAt);
  return d ? d.toLocaleDateString() : '';
};

export function requestRow(r, opts) {
  const o = opts || {};
  const lines = (r.lines || []).length;
  const lk = needsLookup(r);
  return '<button class="row" data-preq="' + esc(r.id) + '">'
    + '<span><span class="nm">' + urgPill(r.urgency) + ' ' + esc(r.unit || 'No machine')
    + '</span><span class="sub">'
    + [stamp(r), r.byName, r.customerName, lines + ' line' + (lines === 1 ? '' : 's'),
       lk ? 'needs a part number' : ''].filter(Boolean).map(esc).join(' · ')
    + '</span></span><span class="ct">'
    + (o.showStatus === false ? '' : '<b>' + esc(STATUS[r.status] || r.status) + '</b>')
    + '</span></button>';
}

export function drawMine(host, rows) {
  const h = ['<div class="wrap"><h1 class="pg">My parts requests</h1>',
    '<p class="lede">What you have asked for, and where it has got to.</p>'];
  if (!rows.length) {
    h.push('<div class="empty">You have not asked for anything yet.</div></div>');
    host.innerHTML = h.join('');
    return;
  }
  const open = rows.filter(r => r.status === 'open');
  const rest = rows.filter(r => r.status !== 'open');
  if (open.length) {
    h.push('<h2 class="sec">Waiting to be ordered</h2><div class="list">',
      sortQueue(open).map(r => requestRow(r, { showStatus: false })).join(''), '</div>');
  }
  if (rest.length) {
    h.push('<h2 class="sec">Ordered and received</h2><div class="list">',
      rest.map(r => requestRow(r)).join(''), '</div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawQueue(host, reqs, orders) {
  const open = sortQueue(reqs.filter(r => r.status === 'open'));
  const onOrder = reqs.filter(r => r.status === 'ordered');
  const down = open.filter(r => r.urgency === 'down').length;
  const lookups = open.filter(needsLookup).length;
  const h = ['<div class="wrap"><h1 class="pg">Parts</h1>',
    '<p class="lede">What the field is waiting on. Rigs that are down sort to the ',
    'top — nothing else competes with them.</p>',
    '<div class="spec">',
    '<div', down ? ' class="bad"' : ' class="missing"', '><b>', down,
    '</b><span>rigs down</span></div>',
    '<div><b>', open.length, '</b><span>to order</span></div>',
    '<div', lookups ? '' : ' class="missing"', '><b>', lookups,
    '</b><span>need a number</span></div>',
    '<div><b>', onOrder.length, '</b><span>on order</span></div>',
    '</div>'];

  if (open.length) {
    h.push('<h2 class="sec">Needs ordering</h2>',
      '<p class="hint">Tick the ones going on the same order.</p>',
      '<div class="list">');
    open.forEach(r => {
      h.push('<div class="row pick"><label class="chk"><input type="checkbox" ',
        'data-pick="', esc(r.id), '"><span></span></label>',
        '<button class="rowbtn" data-preq="', esc(r.id), '">',
        '<span class="nm">', urgPill(r.urgency), ' ', esc(r.unit || 'No machine'),
        '</span><span class="sub">',
        [stamp(r), r.byName, (r.lines || []).length + ' line'
          + ((r.lines || []).length === 1 ? '' : 's'),
         needsLookup(r) ? 'needs a part number' : ''].filter(Boolean).map(esc).join(' · '),
        '</span></button></div>');
    });
    h.push('</div>');
    h.push('<div class="bar" id="pickbar" hidden>',
      '<button class="btn primary" id="makeorder">Put the ticked ones on an order</button>',
      '</div>');
  } else {
    h.push('<div class="empty">Nothing waiting to be ordered.</div>');
  }

  if (onOrder.length) {
    h.push('<h2 class="sec">On order</h2><div class="list">',
      onOrder.map(r => requestRow(r)).join(''), '</div>');
  }

  const live = orders.filter(o => o.status !== 'cancelled');
  if (live.length) {
    h.push('<h2 class="sec">Orders</h2><div class="list">');
    live.forEach(o => h.push('<button class="row" data-pord="', esc(o.id), '">',
      '<span><span class="nm">', esc(o.vendor), o.po ? ' · PO ' + esc(o.po) : '',
      '</span><span class="sub">',
      [(o.lines || []).length + ' line' + ((o.lines || []).length === 1 ? '' : 's'),
       (o.requestIds || []).length + ' request'
         + ((o.requestIds || []).length === 1 ? '' : 's'),
       o.expected ? 'due ' + o.expected : ''].filter(Boolean).map(esc).join(' · '),
      '</span></span><span class="ct"><b class="',
      o.status === 'received' ? 'good' : '', '">',
      o.status === 'received' ? 'Received' : 'Placed', '</b></span></button>'));
    h.push('</div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawOrderForm(host, picked) {
  const lines = picked.reduce((a, r) => a + (r.lines || []).length, 0);
  const h = ['<div class="wrap"><h1 class="pg">Put it on an order</h1>',
    '<p class="lede">', picked.length, ' request', picked.length === 1 ? '' : 's',
    ', ', lines, ' line', lines === 1 ? '' : 's', '. The lines are copied onto the ',
    'order as they are now, so what the order says was bought cannot change afterwards.',
    '</p>',
    '<div class="list">', picked.map(r => requestRow(r, { showStatus: false })).join(''),
    '</div>',
    '<form class="pform" id="oform" novalidate><div class="fgrid">',
    '<div class="fld"><label for="o_vendor">Ordered from</label>',
    '<input id="o_vendor" data-o="vendor" type="text" autocomplete="off"></div>',
    '<div class="fld"><label for="o_po">PO number</label>',
    '<input id="o_po" data-o="po" type="text" autocomplete="off"></div>',
    '<div class="fld"><label for="o_exp">Expected</label>',
    '<input id="o_exp" data-o="expected" type="date"></div>',
    '<div class="fld wide"><label for="o_note">Note</label>',
    '<textarea id="o_note" data-o="note" rows="2"></textarea></div>',
    '</div><p class="msg" id="omsg"></p>',
    '<button type="button" class="btn primary" id="osave">Create the order</button>',
    '</form></div>'];
  host.innerHTML = h.join('');
}

function lineTable(lines, opts) {
  const o = opts || {};
  const h = ['<div class="mx"><table><thead><tr><th>Part number</th><th>Qty</th>',
    '<th>What it is</th><th>Vendor</th>', o.withUnit ? '<th>Machine</th>' : '',
    '</tr></thead><tbody>'];
  lines.forEach(l => {
    h.push('<tr><td>', l.pn ? esc(l.pn)
      : '<i class="lookup">to look up</i>', '</td>',
      '<td class="num">', esc(l.qty), '</td>',
      '<td>', esc(l.desc || ''), '</td>',
      '<td>', esc(l.vendor || ''), '</td>',
      o.withUnit ? '<td>' + esc(l.unit || '') + '</td>' : '',
      '</tr>');
  });
  h.push('</tbody></table></div>');
  return h.join('');
}

export function drawRequest(host, r, opts) {
  const o = opts || {};
  const d = asDate(r.createdAt);
  const h = ['<div class="wrap"><div class="sheet">',
    '<div class="shead"><div><b>Parts request</b>',
    '<span>Broken Spoke Drilling Solutions</span></div>',
    '<div class="stamp ', r.urgency === 'down' ? 'fail' : 'pass', '">',
    esc(((URG[r.urgency] || {}).label || '').toUpperCase()), '</div></div>',
    '<div class="sgrid">',
    '<div><span>Machine</span><b>', esc(r.unit || '—'), '</b></div>',
    '<div><span>Serial</span><b>', r.serial ? esc(r.serial) : '<i>none</i>', '</b></div>',
    '<div><span>Customer</span><b>', esc(r.customerName || '—'), '</b></div>',
    '<div><span>Work order</span><b>', r.workOrder ? esc(r.workOrder) : '<i>none</i>', '</b></div>',
    '<div><span>Asked by</span><b>', esc(r.byName || ''), '</b></div>',
    '<div><span>When</span><b>', d ? esc(d.toLocaleString()) : '', '</b></div>',
    '<div><span>Status</span><b>', esc(STATUS[r.status] || r.status), '</b></div>',
    '</div>',
    '<h3 class="ssec">Parts</h3>', lineTable(r.lines || []),
    r.note ? '<h3 class="ssec">Note</h3><div class="sbody">' + esc(r.note) + '</div>' : '',
    '</div>'];
  if (needsLookup(r)) {
    h.push('<div class="note warn"><b>At least one line has no part number.</b> ',
      'That is allowed on purpose — a description and a lookup beats a guessed ',
      'number. Somebody has to find it before this goes on an order.</div>');
  }
  if (r.status === 'ordered' || r.status === 'received') {
    h.push('<div class="note"><b>On order', r.orderId ? '' : '', '.</b> ',
      r.status === 'received' ? 'It has been received.' : 'Waiting on the vendor.',
      r.orderId ? ' <button class="mini" data-pord="' + esc(r.orderId)
        + '">Open the order</button>' : '', '</div>');
  }
  if (o.canOrder && r.status === 'open') {
    h.push('<div class="bar">',
      '<button class="mini" data-cancelreq="', esc(r.id), '">Cancel this request</button>',
      '</div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawOrder(host, o, opts) {
  const can = (opts || {}).canOrder;
  const placed = asDate(o.placedAt), recv = asDate(o.receivedAt);
  const h = ['<div class="wrap"><div class="sheet">',
    '<div class="shead"><div><b>Parts order</b><span>', esc(o.vendor), '</span></div>',
    '<div class="stamp ', o.status === 'received' ? 'pass' : 'fail', '">',
    o.status === 'received' ? 'RECEIVED' : 'PLACED', '</div></div>',
    '<div class="sgrid">',
    '<div><span>Ordered from</span><b>', esc(o.vendor), '</b></div>',
    '<div><span>PO</span><b>', o.po ? esc(o.po) : '<i>none</i>', '</b></div>',
    '<div><span>Expected</span><b>', o.expected ? esc(o.expected) : '<i>not said</i>', '</b></div>',
    '<div><span>Placed by</span><b>', esc(o.placedBy || ''), '</b></div>',
    '<div><span>Placed</span><b>', placed ? esc(placed.toLocaleString()) : '', '</b></div>',
    recv ? '<div><span>Received</span><b>' + esc(recv.toLocaleString()) + '</b></div>' : '',
    '</div>',
    '<h3 class="ssec">Lines</h3>', lineTable(o.lines || [], { withUnit: true }),
    o.note ? '<h3 class="ssec">Note</h3><div class="sbody">' + esc(o.note) + '</div>' : '',
    '</div>'];
  if (can && o.status !== 'received') {
    h.push('<div class="note"><b>When it turns up.</b> Marking it received closes ',
      'out every request on it, so the techs who asked stop wondering.',
      '<br><button class="mini" data-receive="', esc(o.id), '">Mark it received</button>',
      '</div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}
