/* Receipts: the photo already works, this is the coding that was missing.
 *
 * WHAT THIS DOES NOT CHANGE. The photo still goes to the same Drive folder
 * through the same Apps Script backend that has always put it there, and
 * that backend still reads the receipt with Claude and hands back the
 * vendor, invoice number, date and amount. None of that is rebuilt here -
 * it works, Jazmine works out of that folder, and Mike's instruction was
 * that receipts stay as they are.
 *
 * WHAT IT ADDS, and why each one is here rather than in the spreadsheet:
 *
 *   - The service order is PICKED, not typed. The old log has "Tr990",
 *     "820 fuel" and "Management approved" in the work order column, and
 *     every one of those is a real Fullbay SO that somebody could not put
 *     a number to while standing at a counter. A picker is the whole fix.
 *
 *   - A receipt can be SPLIT across several service orders. One card swipe
 *     for a part and a tin of shop supplies is two different jobs, and
 *     Fullbay structurally cannot say so - one purchase order belongs to
 *     one service order. Lumping it either overcharges the customer or
 *     quietly eats the shop supply recovery.
 *
 *   - It becomes a WORKLIST for the office instead of a pile. Everything
 *     needed to raise the purchase order and the bill is on one row with
 *     the image beside it.
 *
 * WHAT IS DELIBERATELY ABSENT. There is no "paid" field. Payment lives in
 * QuickBooks and Melio. The old sheet had one and nobody ever updated it,
 * which is what an unowned duplicate looks like from the inside - its own
 * due-date formula reads #N/A because of it.
 */
import { CONFIG } from './config.js';
import * as auth from './auth.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STATUS = {
  new:     'Waiting on the office',
  entered: 'In Fullbay',
  query:   'Needs Mike',
};

/* Money is handled in whole cents all the way through. A receipt that adds
   up to a penny out is a receipt somebody has to go and look at, and
   floating point will produce those on its own if you let it. */
export const cents = v => {
  const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? Math.round(n * 100) : NaN;
};
export const money = c => (c / 100).toFixed(2);

/* ---------- what a receipt can be coded to --------------------------- */

/* The standing service orders, read off Fullbay in October 2026. These
   barely change, which is why they can sit in config rather than needing
   an export - and they cover fuel, shop supplies and every truck, which is
   most of what gets bought at a counter. */
export function buckets() {
  return (CONFIG.receipts && CONFIG.receipts.standingSOs) || [];
}

/* Everything else: service orders raised through this app (we know their
   numbers because the office put them back on the request), plus whatever
   the latest Fullbay export carried. A typed number is still accepted -
   refusing one would just send people back to writing "820 fuel". */
export async function pickList(workOrders) {
  const out = buckets().map(b => ({ ...b, kind: 'standing' }));
  (workOrders || []).forEach(w => {
    if (!w.soNumber) return;
    out.push({
      so: String(w.soNumber),
      label: [w.customerName, w.unit].filter(Boolean).join(' · ') || 'Work order',
      kind: 'job',
    });
  });
  return out;
}

/* ---------- reading the form ----------------------------------------- */

/* Returns { problems, at, rec }. `at` is the selector of the first thing to
   fix, so the screen can scroll to it and mark it - the same contract the
   pre-op and JSA forms use, because being told what is wrong without being
   shown where is the complaint that started all of this. */
export function collect(host, ctx) {
  const problems = [];
  let at = null;
  const bad = (t, sel) => { problems.push(t); if (!at && sel) at = sel; };
  const val = k => {
    const el = host.querySelector('[data-r="' + k + '"]');
    return el ? String(el.value || '').trim() : '';
  };

  const vendor = val('vendor');
  if (!vendor) bad('Who was it bought from?', '[data-r="vendor"]');

  const total = cents(val('amount'));
  if (!val('amount')) bad('How much was it?', '[data-r="amount"]');
  else if (!isFinite(total)) bad('That amount is not a number.', '[data-r="amount"]');
  else if (total <= 0) bad('The amount has to be more than nothing.', '[data-r="amount"]');

  if (!val('invoiceDate')) bad('What date is on it?', '[data-r="invoiceDate"]');
  if (!val('paymentMethod')) bad('How was it paid for?', '[data-r="paymentMethod"]');

  /* The lines. One is the normal case and is filled in for you; more than
     one is the split, and then the parts have to add up to the whole. */
  const lines = [];
  host.querySelectorAll('[data-line]').forEach(row => {
    const so = String((row.querySelector('[data-l="so"]') || {}).value || '').trim();
    const amt = String((row.querySelector('[data-l="amount"]') || {}).value || '').trim();
    if (!so && !amt) return;
    lines.push({ so, amount: cents(amt), raw: amt, el: row });
  });

  if (!lines.length) {
    bad('Put it against a job, a truck or an overhead bucket.', '[data-l="so"]');
  }
  lines.forEach((l, i) => {
    if (!l.so) bad('Line ' + (i + 1) + ' has an amount but no service order.', '[data-l="so"]');
    if (!isFinite(l.amount)) bad('Line ' + (i + 1) + ' has an amount that is not a number.', '[data-l="amount"]');
  });

  /* The check that earns its keep. A split that does not add up is the one
     error nobody notices until the books are being closed. */
  if (lines.length && isFinite(total) && lines.every(l => isFinite(l.amount))) {
    const sum = lines.reduce((a, l) => a + l.amount, 0);
    if (sum !== total) {
      const over = sum > total;
      bad('The lines come to $' + money(sum) + ' but the receipt is $' + money(total)
        + ' — $' + money(Math.abs(sum - total)) + (over ? ' too much.' : ' is unaccounted for.'),
        '[data-l="amount"]');
    }
  }

  const me = auth.currentUser();
  const known = pick(ctx, lines.map(l => l.so));

  return {
    problems,
    at,
    rec: problems.length ? null : {
      uid: me.uid, byName: me.name, byEmail: me.email || '',
      vendor: tidyVendor(vendor),
      invoiceNumber: val('invoiceNumber'),
      invoiceDate: val('invoiceDate'),
      dueDate: val('dueDate'),
      amount: total,
      paymentMethod: val('paymentMethod'),
      docType: val('docType') || 'Invoice',
      note: val('note'),
      lines: lines.map(l => ({ so: l.so, amount: l.amount, label: known[l.so] || '' })),
      soList: lines.map(l => l.so),
      poNumber: '',
      driveFileUrl: (ctx && ctx.driveFileUrl) || '',
      driveFileId: (ctx && ctx.driveFileId) || '',
      status: 'new',
      createdAt: new Date().toISOString(),
    },
  };
}

function pick(ctx, sos) {
  const out = {};
  ((ctx && ctx.picks) || []).forEach(p => { if (sos.indexOf(p.so) >= 0) out[p.so] = p.label; });
  return out;
}

/* "Crus" and "CRUS OIL INC." were two vendors in the old log and one
   company in life. Matching case-insensitively against the known list
   collapses them without anybody having to tidy up afterwards. */
export function tidyVendor(name) {
  const n = String(name || '').trim();
  const known = (CONFIG.receipts && CONFIG.receipts.vendors) || [];
  const hit = known.find(k => k.toUpperCase() === n.toUpperCase());
  return hit || n;
}

/* ---------- storage --------------------------------------------------- */

const KEY = 'bsds.receipts';
const localAll = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
};
const localPut = rows => {
  try { sessionStorage.setItem(KEY, JSON.stringify(rows)); } catch (e) { /* ignore */ }
};

export async function file(rec) {
  const u = auth.currentUser();
  if (u.demo) {
    const all = localAll();
    const row = { ...rec, id: 'demo-' + Date.now() };
    all.unshift(row);
    localPut(all);
    return row;
  }
  const { d, m } = await auth.db();
  const ref = await m.addDoc(m.collection(d, 'receipts'),
    { ...rec, createdAt: m.serverTimestamp() });
  return { ...rec, id: ref.id };
}

/* The old spreadsheet keeps getting its row during the changeover, because
   that is where Jazmine works today and a half-moved process is worse than
   either end of it. Turn `alsoWriteSheet` off the day she works from the
   worklist instead - this is duplication with an owner and an end date,
   which is a different thing from duplication that crept in.

   A split cannot be written to that sheet: it has one work order column.
   The first line goes in and the cell says SPLIT, which is true and is
   visible, rather than silently recording a part of it as the whole. */
export async function alsoSheet(rec) {
  if (!CONFIG.receipts || !CONFIG.receipts.alsoWriteSheet) return { skipped: true };
  const url = CONFIG.backends && CONFIG.backends.launcher;
  if (!url) return { skipped: true };
  const split = rec.lines.length > 1;
  const body = {
    action: 'saveReceipt',
    payload: {
      submittedBy: rec.byName,
      vendor: rec.vendor,
      invoiceNumber: rec.invoiceNumber,
      invoiceDate: rec.invoiceDate,
      dueDate: rec.dueDate,
      poNumber: rec.poNumber,
      workOrder: split ? ('SPLIT — ' + rec.soList.join(', ')) : (rec.soList[0] || ''),
      paymentMethod: rec.paymentMethod,
      amount: money(rec.amount),
      docType: rec.docType,
      driveFileUrl: rec.driveFileUrl,
    },
  };
  try {
    await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    return { ok: true };
  } catch (e) {
    /* The record is already in the app. A sheet that did not get its copy
       is a tidiness problem, not a lost receipt. */
    return { ok: false, message: e.message };
  }
}

export async function list(opts) {
  const o = opts || {};
  const u = auth.currentUser();
  if (u.demo) {
    const rows = localAll();
    return o.status ? rows.filter(r => r.status === o.status) : rows;
  }
  const { d, m } = await auth.db();
  const parts = [m.collection(d, 'receipts')];
  if (o.status) parts.push(m.where('status', '==', o.status));
  parts.push(m.orderBy('createdAt', 'desc'), m.limit(200));
  const snap = await m.getDocs(m.query(...parts));
  return snap.docs.map(x => ({ id: x.id, ...x.data() }));
}

/* Marking it entered is what moves it off the worklist, and it records the
   Fullbay purchase order number - the join key that lets the app later say
   which purchase orders have no receipt against them. */
export async function markEntered(id, poNumber) {
  const po = String(poNumber || '').trim();
  const u = auth.currentUser();
  const patch = { status: 'entered', poNumber: po, enteredBy: u.name };
  if (u.demo) {
    localPut(localAll().map(r => r.id === id ? { ...r, ...patch } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'receipts', id), { ...patch, enteredAt: m.serverTimestamp() });
}

export async function flag(id, why) {
  const u = auth.currentUser();
  const patch = { status: 'query', queryNote: String(why || '').trim(), queriedBy: u.name };
  if (u.demo) {
    localPut(localAll().map(r => r.id === id ? { ...r, ...patch } : r));
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'receipts', id), patch);
}

/* ---------- what the office is waiting on ----------------------------- */

export function waiting(rows) {
  return (rows || []).filter(r => r.status === 'new').length;
}

export function unsplit(rows) {
  return (rows || []).filter(r => (r.lines || []).length > 1).length;
}

export { esc };

/* ---------- the photo ------------------------------------------------- */

/* Straight to the backend that has always done this: it writes the image
   to the Drive folder FIRST and reads it afterwards, so a failed read
   never costs somebody the photo they just took. We mirror that order of
   priorities here - if the read fails we still have the file and the
   person fills the fields in by hand. */
export async function scan(fileObj) {
  const url = CONFIG.backends && CONFIG.backends.launcher;
  if (!url) throw new Error('No receipts backend is configured.');
  const res = await fetch(url, {
    method: 'POST',
    /* text/plain keeps this a simple cross-origin request, with no
       preflight for Apps Script to answer. The Launcher has always sent it
       this way; copying a path that works beats reasoning about one. */
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'scanReceipt',
      base64Data: bareBase64(await toDataUrl(fileObj)),
      fileName: fileObj.name || '',
      mimeType: fileObj.type || 'image/jpeg',
    }),
  });
  let out;
  try { out = await res.json(); }
  catch (e) { throw new Error('The receipts backend answered with something that was not JSON.'); }
  if (out.status !== 'ok') throw new Error(out.message || 'The photo did not go through.');
  return out;
}

/* THE PREFIX COMES OFF HERE, not at the far end.
 *
 * FileReader hands back "data:image/jpeg;base64,AAAA..." and the backend
 * wants the part after the comma. The script in Drive has a helper that
 * strips it, but the deployment actually answering that URL does not -
 * sending the whole data URL came back as "Exception: could not decode
 * string", which is Apps Script failing to base64-decode "data:image/...".
 *
 * So this is done on our side, the way the Launcher has always done it.
 * Stripping something already stripped is harmless; relying on the far end
 * to strip it was not. */
export function bareBase64(dataUrl) {
  const s = String(dataUrl || '');
  const i = s.indexOf('base64,');
  return i > -1 ? s.slice(i + 7) : s;
}

function toDataUrl(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsDataURL(f);
  });
}

/* ---------- drawing --------------------------------------------------- */

const opt = (v, sel) => '<option value="' + esc(v) + '"'
  + (sel && String(sel) === String(v) ? ' selected' : '') + '>' + esc(v) + '</option>';

export function drawForm(host, ctx) {
  const c = ctx || {};
  const picks = c.picks || [];
  const pays = (CONFIG.receipts && CONFIG.receipts.payments) || [];
  const vends = (CONFIG.receipts && CONFIG.receipts.vendors) || [];
  const h = ['<div class="wrap"><form id="rform" autocomplete="off">'];

  h.push('<h2 class="sec">The photo</h2><div class="panel">',
    c.driveFileUrl
      ? '<p class="msg good">Saved. <a href="' + esc(c.driveFileUrl)
        + '" target="_blank" rel="noopener">Open it</a></p>'
      : '<p class="hint">Take it now and the fields below fill themselves in. '
        + 'The photo lands in the Drive folder either way.</p>',
    '<input type="file" id="rphoto" accept="image/*,application/pdf" capture="environment">',
    '<p class="msg" id="rscan"></p></div>');

  h.push('<h2 class="sec">What it was</h2><div class="panel"><div class="fgrid">');
  h.push(fld('vendor', 'Vendor', 'text', c.vendor, 'rvend'),
    '<datalist id="rvend">', vends.map(v => '<option value="' + esc(v) + '"></option>').join(''), '</datalist>');
  h.push(fld('amount', 'Amount', 'text', c.amount));
  h.push(fld('invoiceNumber', 'Invoice number', 'text', c.invoiceNumber));
  h.push(fld('invoiceDate', 'Date on it', 'date', c.invoiceDate));
  h.push(fld('dueDate', 'Due date', 'date', c.dueDate));
  h.push('<div class="fld"><label for="r_paymentMethod">Paid with</label>',
    '<select id="r_paymentMethod" data-r="paymentMethod"><option value=""></option>',
    pays.map(p => opt(p, c.paymentMethod)).join(''), '</select></div>');
  h.push('<div class="fld"><label for="r_docType">Kind</label>',
    '<select id="r_docType" data-r="docType">',
    ['Invoice', 'Fuel', 'Packing Slip'].map(p => opt(p, c.docType || 'Invoice')).join(''),
    '</select></div>');
  h.push('</div></div>');

  h.push('<h2 class="sec">What it was for</h2><div class="panel">',
    '<p class="hint">One job is the usual case. Bought shop supplies while you were ',
    'picking up a part? Add a line and split it — that is the only way both ',
    'ends get charged properly.</p>',
    '<div id="rlines"></div>',
    '<button type="button" class="mini" id="raddline">+ SPLIT IT ACROSS ANOTHER JOB</button>',
    '<p class="hint" id="rleft"></p></div>');

  h.push('<h2 class="sec">Anything else</h2><div class="panel">',
    '<textarea id="r_note" data-r="note" rows="2"></textarea></div>');

  h.push('<p class="msg" id="rmsg"></p>',
    '<button type="button" class="btn primary" id="rsend">SEND IT IN</button>',
    '</form><datalist id="rsos">',
    picks.map(p => '<option value="' + esc(p.so) + '">' + esc(p.label) + '</option>').join(''),
    '</datalist></div>');

  host.innerHTML = h.join('');
}

function fld(key, label, type, value, list) {
  return '<div class="fld"><label for="r_' + key + '">' + esc(label) + '</label>'
    + '<input id="r_' + key + '" data-r="' + key + '" type="' + type + '"'
    + (list ? ' list="' + list + '"' : '')
    + ' value="' + esc(value || '') + '" autocomplete="off"></div>';
}

/* A line is a service order and an amount. The first one is drawn with the
   whole amount already in it, because one job is what usually happens and
   nobody should have to type a number they have already typed. */
export function lineRow(i, so, amount) {
  return '<div class="line" data-line="' + i + '"><div class="fgrid">'
    + '<div class="fld"><label>Service order</label>'
    + '<input data-l="so" list="rsos" value="' + esc(so || '') + '" inputmode="numeric"></div>'
    + '<div class="fld"><label>Amount</label>'
    + '<input data-l="amount" value="' + esc(amount || '') + '" inputmode="decimal"></div>'
    + '</div>' + (i > 0 ? '<button type="button" class="mini" data-rmline="' + i + '">REMOVE</button>' : '')
    + '</div>';
}

export function drawQueue(host, rows, ctx) {
  const o = ctx || {};
  if (!rows.length) {
    host.innerHTML = '<div class="wrap"><div class="empty">Nothing waiting. '
      + 'Every receipt sent in has been entered.</div></div>';
    return;
  }
  const h = ['<div class="wrap"><div class="list">'];
  rows.forEach(r => {
    const n = (r.lines || []).length;
    h.push('<button class="row" data-rrec="', esc(r.id), '"><span>',
      '<span class="nm">', esc(r.vendor || 'No vendor'), ' · $', money(r.amount || 0), '</span>',
      '<span class="sub">', esc(r.byName || ''), ' · ',
      n > 1 ? ('split across ' + n + ' jobs') : ('SO ' + esc((r.soList || [])[0] || '—')),
      r.invoiceDate ? ' · ' + esc(r.invoiceDate) : '', '</span></span>',
      '<span class="ct">›</span></button>');
  });
  h.push('</div>');
  if (o.showHint !== false) {
    h.push('<div class="note"><b>Working this list</b> is raising the purchase order ',
      'and the bill in Fullbay from what is already on the row, then putting the ',
      'purchase order number back here. That number is what later tells you which ',
      'purchase orders have no receipt against them.</div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawRecord(host, r, ctx) {
  const o = ctx || {};
  const lines = r.lines || [];
  const h = ['<div class="wrap"><div class="sheet">'];
  h.push('<div class="head"><div><h1>', esc(r.vendor || 'Receipt'), '</h1>',
    '<p class="sub">', esc(r.byName || ''), '</p></div>',
    '<div class="stamp ', r.status === 'entered' ? 'pass' : 'fail', '">$',
    money(r.amount || 0), '</div></div>');

  h.push('<div class="grid">',
    cell('Invoice', r.invoiceNumber), cell('Date', r.invoiceDate),
    cell('Due', r.dueDate), cell('Paid with', r.paymentMethod),
    cell('Kind', r.docType), cell('Status', STATUS[r.status] || r.status),
    r.poNumber ? cell('Fullbay PO', r.poNumber) : '',
    '</div>');

  h.push('<h2 class="sec">Coded to</h2><table class="tbl"><tbody>');
  lines.forEach(l => h.push('<tr><td>', esc(l.so), ' ', esc(l.label || ''),
    '</td><td class="num">$', money(l.amount || 0), '</td></tr>'));
  if (lines.length > 1) {
    h.push('<tr><td><b>Total</b></td><td class="num"><b>$', money(r.amount || 0), '</b></td></tr>');
  }
  h.push('</tbody></table>');

  if (r.note) h.push('<div class="note">', esc(r.note), '</div>');
  if (r.queryNote) h.push('<div class="note warn"><b>Queried.</b> ', esc(r.queryNote), '</div>');

  if (o.canOpenImage && r.driveFileUrl) {
    h.push('<div class="bar"><a class="mini" href="', esc(r.driveFileUrl),
      '" target="_blank" rel="noopener">Open the photo</a></div>');
  }

  if (o.canWork && r.status !== 'entered') {
    h.push('<h2 class="sec">Once it is in Fullbay</h2><div class="panel">',
      '<div class="fld"><label for="r_po">Purchase order number</label>',
      '<input id="r_po" type="text" autocomplete="off"></div>',
      '<p class="msg" id="rqmsg"></p>',
      '<button type="button" class="btn primary" data-rentered="', esc(r.id),
      '">Mark it entered</button>',
      '<button type="button" class="mini" data-rquery="', esc(r.id), '">Query it</button>',
      '</div>');
  }
  h.push('</div></div>');
  host.innerHTML = h.join('');
}

const cell = (k, v) => v
  ? '<div class="c"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'
  : '';
