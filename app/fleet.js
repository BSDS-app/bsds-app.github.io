/* Machines and customers: adding them, fixing them, retiring them.
 *
 * One rule in here matters more than the rest of the file put together:
 *
 *   THE SERIAL NUMBER IS THE KEY TO THE PARTS BOOKS.
 *
 * The books are laid out by serial. If two machines end up carrying the
 * same serial, or a serial is typed one character out, the app will happily
 * hand a tech the book for a different rig - and he will order the wrong
 * parts off it, or worse, work off the wrong hydraulic schematic. That is
 * not a tidy-up-later kind of mistake, so a duplicate serial is refused
 * outright rather than warned about, and clearing a serial that a book is
 * matched to has to be confirmed.
 *
 * Everything else here is ordinary: a machine with no serial is normal (14
 * came off the Fullbay export that way) and simply has no book yet; a
 * machine that leaves the fleet is RETIRED rather than deleted, because
 * pre-ops and JSAs filed against it still name it.
 */
import { CONFIG } from './config.js';
import * as auth from './auth.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slug = s => String(s || '').toLowerCase().trim()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const machineId = (customerId, unit) => slug(customerId) + '--' + slug(unit);

/* Serials are compared with the noise taken out, because the difference
   between "110T15405-1" and "110t15405 1" is a typist, not a machine. */
const serialKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const needSerial = equipment =>
  equipment.filter(e => !e.serial && !e.retired);

export const bookFor = serial =>
  CONFIG.books.find(b => b.serial && serial && serialKey(b.serial) === serialKey(serial));

/* ---------- validation ------------------------------------------------ */

export function validateMachine(rec, data, originalId) {
  const problems = [];
  if (!String(rec.unit || '').trim()) problems.push('Give it a unit number.');
  if (!rec.customer) problems.push('Say whose machine it is.');
  else if (!data.customers.some(c => c.id === rec.customer)) {
    problems.push('That customer is not on file.');
  }

  const key = serialKey(rec.serial);
  if (key) {
    const clash = data.equipment.find(e => e.id !== originalId && serialKey(e.serial) === key);
    if (clash) {
      problems.push('Serial ' + rec.serial + ' is already on ' + (clash.unit || clash.id)
        + ' (' + (clash.customerName || 'another customer') + '). Two machines cannot '
        + 'share a serial — the parts books are laid out by serial, so one of them '
        + 'would open the wrong book.');
    }
    if (key.length < 3) problems.push('That serial looks too short to be real.');
  }

  if (rec.year !== null && rec.year !== '' && rec.year !== undefined) {
    const y = Number(rec.year);
    const now = new Date().getFullYear();
    if (!Number.isInteger(y) || y < 1950 || y > now + 1) {
      problems.push('Year should be between 1950 and ' + (now + 1) + ', or left blank.');
    }
  }
  if (rec.meter !== null && rec.meter !== '' && rec.meter !== undefined) {
    const m = Number(rec.meter);
    if (!Number.isFinite(m) || m < 0) problems.push('Meter should be a number, or blank.');
  }

  if (!originalId) {
    const id = machineId(rec.customer, rec.unit);
    if (data.equipment.some(e => e.id === id)) {
      problems.push('That customer already has a unit ' + rec.unit + '.');
    }
  }
  return problems;
}

export function validateCustomer(rec, data, originalId) {
  const problems = [];
  const name = String(rec.name || '').trim();
  if (!name) problems.push('Give the customer a name.');
  if (name && slug(name).length < 2) problems.push('That name is too short to file under.');
  const id = originalId || slug(name);
  if (!originalId && data.customers.some(c => c.id === id)) {
    problems.push('There is already a customer filed under that name.');
  }
  return problems;
}

/* ---------- local overlay (demo) -------------------------------------- */
/* Demo mode reads the fleet from the seed files, which are read-only. Edits
   are kept beside them in sessionStorage and folded in on read, so the whole
   flow can be walked through - and tested - without a database. */

const K_EQ = 'bsds.equipment', K_CU = 'bsds.customers';
const read = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || '{}'); }
  catch (e) { return {}; } };
const write = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function overlay(data) {
  const eq = read(K_EQ), cu = read(K_CU);
  const merge = (rows, over) => {
    const byId = new Map(rows.map(r => [r.id, r]));
    Object.entries(over).forEach(([id, patch]) => {
      byId.set(id, { ...(byId.get(id) || { id }), ...patch });
    });
    return [...byId.values()];
  };
  return { customers: merge(data.customers, cu), equipment: merge(data.equipment, eq) };
}

/* ---------- writing --------------------------------------------------- */

export async function saveMachine(rec, originalId) {
  const id = originalId || machineId(rec.customer, rec.unit);
  const cust = rec.customerName || '';
  const doc = {
    id,
    customer: rec.customer,
    customerName: cust,
    unit: String(rec.unit).trim(),
    nickname: String(rec.nickname || '').trim(),
    serial: String(rec.serial || '').trim(),
    make: String(rec.make || '').trim(),
    modelOnly: String(rec.modelOnly || '').trim(),
    model: String(rec.model || '').trim()
      || [rec.year, rec.make, rec.modelOnly].filter(Boolean).join(' ').trim(),
    year: rec.year === '' || rec.year == null ? null : Number(rec.year),
    meter: rec.meter === '' || rec.meter == null ? null : Number(rec.meter),
    retired: !!rec.retired,
  };
  const me = auth.currentUser();
  if (me && me.demo) {
    const over = read(K_EQ);
    over[id] = doc;
    write(K_EQ, over);
    return doc;
  }
  const { d, m } = await auth.db();
  await m.setDoc(m.doc(d, 'equipment', id), doc, { merge: true });
  return doc;
}

export async function retireMachine(id, retired) {
  const me = auth.currentUser();
  if (me && me.demo) {
    const over = read(K_EQ);
    over[id] = { ...(over[id] || { id }), retired: !!retired };
    write(K_EQ, over);
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'equipment', id), { retired: !!retired });
}

/* Renaming a customer writes ONE document.
 *
 * Each machine carries its customer's name as well as its id, so the fleet
 * search can match on a customer name without a join. The obvious way to
 * rename is to rewrite that name on every machine - and that is wrong here,
 * because Jazmine may edit customers and may not write equipment. Her rename
 * would update the customer, be refused on the machines, and leave the two
 * lists disagreeing with no sign that anything had failed.
 *
 * So the name on a machine is treated as a cache, and nameFleet() below
 * refreshes it from the customer record every time the fleet is read. One
 * write, no half-finished rename, and nobody needs write access they should
 * not have. */
export async function saveCustomer(rec, originalId) {
  const id = originalId || slug(rec.name);
  const doc = { id, name: String(rec.name).trim(), inactive: !!rec.inactive };
  const me = auth.currentUser();
  if (me && me.demo) {
    const over = read(K_CU);
    over[id] = doc;
    write(K_CU, over);
    return doc;
  }
  const { d, m } = await auth.db();
  await m.setDoc(m.doc(d, 'customers', id), doc, { merge: true });
  return doc;
}

/* The customer record is the authority on the customer's name. */
export function nameFleet(data) {
  const byId = new Map((data.customers || []).map(c => [c.id, c.name]));
  return {
    customers: data.customers,
    equipment: (data.equipment || []).map(e =>
      byId.has(e.customer) ? { ...e, customerName: byId.get(e.customer) } : e),
  };
}

/* ---------- forms ----------------------------------------------------- */

const field = (key, label, value, kind, extra) =>
  '<div class="fld' + (extra && extra.wide ? ' wide' : '') + '">'
  + '<label for="m_' + key + '">' + esc(label) + '</label>'
  + '<input id="m_' + key + '" data-m="' + key + '" type="' + (kind || 'text') + '" '
  + (kind === 'number' ? 'inputmode="numeric" ' : '')
  + 'autocomplete="off" spellcheck="false" value="' + esc(value == null ? '' : value) + '">'
  + (extra && extra.hint ? '<p class="hint">' + extra.hint + '</p>' : '')
  + '</div>';

export function drawMachineForm(host, ctx) {
  const e = ctx.machine || {};
  const isNew = !ctx.machine;
  const book = bookFor(e.serial);
  const h = ['<div class="wrap">',
    '<h1 class="pg">', isNew ? 'Add a machine' : 'Edit ' + esc(e.unit), '</h1>',
    '<p class="lede">', isNew
      ? 'Whatever you know now. A machine with no serial is fine — it just has no parts book until the plate is read.'
      : 'Fixing what is on file. The serial is the one to get right.',
    '</p>',
    '<form class="pform" id="mform" novalidate><div class="fgrid">'];

  h.push('<div class="fld"><label for="m_customer">Customer</label>',
    '<select id="m_customer" data-m="customer">',
    '<option value="">— choose —</option>',
    ctx.customers.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(c => '<option value="' + esc(c.id) + '"'
        + (e.customer === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join(''),
    '</select></div>');

  h.push(field('unit', 'Unit number', e.unit, 'text'));
  h.push(field('nickname', 'Nickname', e.nickname, 'text',
    { hint: 'What the crew calls it. Optional.' }));
  h.push(field('serial', 'Serial number', e.serial, 'text', { wide: true,
    hint: book
      ? 'This serial is matched to the parts book <b>' + esc(book.title) + '</b>. '
        + 'Change it and that link moves with it.'
      : 'The parts books are laid out by serial. Filling this in is what connects '
        + 'this machine to its book — and no two machines may carry the same one.' }));
  h.push(field('make', 'Make', e.make, 'text'));
  h.push(field('modelOnly', 'Model', e.modelOnly || e.model, 'text'));
  h.push(field('year', 'Year', e.year, 'number'));
  h.push(field('meter', 'Meter', e.meter, 'number',
    { hint: 'Hours or miles, whichever this machine counts.' }));
  h.push('</div>');

  h.push('<p class="msg" id="mmsg"></p>',
    '<button type="button" class="btn primary" id="msave">',
    isNew ? 'Add this machine' : 'Save changes', '</button>');
  if (!isNew) {
    h.push('<button type="button" class="btn ghost" id="mretire" data-to="',
      e.retired ? 'back' : 'off', '">',
      e.retired ? 'Put it back in the fleet' : 'Retire this machine', '</button>',
      '<div class="note"><b>Retire, do not delete.</b> Pre-ops and JSAs filed against ',
      'this machine still name it. Retiring takes it off the working list and leaves ',
      'the paperwork intact.</div>');
  }
  h.push('</form></div>');
  host.innerHTML = h.join('');
}

export function drawCustomerForm(host, ctx) {
  const c = ctx.customer || {};
  const isNew = !ctx.customer;
  const mine = (ctx.equipment || []).filter(e => e.customer === c.id);
  const h = ['<div class="wrap">',
    '<h1 class="pg">', isNew ? 'Add a customer' : 'Edit ' + esc(c.name), '</h1>',
    '<form class="pform" id="cform" novalidate><div class="fgrid">',
    field('name', 'Customer name', c.name, 'text', { wide: true }),
    '</div>'];
  if (!isNew && mine.length) {
    h.push('<div class="note"><b>', mine.length, ' machine',
      mine.length === 1 ? '' : 's', ' on this account.</b> A new name shows on every ',
      'one of them straight away — the customer record is what names them, so the ',
      'two lists cannot drift apart.</div>');
  }
  h.push('<p class="msg" id="cmsg"></p>',
    '<button type="button" class="btn primary" id="csave">',
    isNew ? 'Add this customer' : 'Save changes', '</button>',
    '</form></div>');
  host.innerHTML = h.join('');
}

/* Reads whichever form is on screen. */
export function readForm(host, key) {
  const out = {};
  host.querySelectorAll('[data-' + key + ']').forEach(el => {
    out[el.dataset[key]] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  return out;
}
