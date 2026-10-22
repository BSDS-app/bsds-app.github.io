/* Parts books, and the one rule that matters: a book belongs to a SERIAL.
 *
 * Mike's standing rule is that a book-to-machine mismatch is unacceptable.
 * Two machines off the same line with one differing part number are two
 * different books, and handing a tech the wrong one costs a trip, a day,
 * or a wrong part on a rig that is already down.
 *
 * So there are exactly two ways to arrive at a book, and they never look
 * alike:
 *
 *   MATCHED   the machine's serial equals the book's serial. Nothing else
 *             counts - not a near-miss, not the same model, not one digit
 *             out. 60674 is not 60673. The fleet has two of those and both
 *             are deliberately refused.
 *
 *   JUDGEMENT somebody who knows the machine picked a book for it, because
 *             the serial is unknown or has no book. This is legitimate and
 *             necessary - it is how the job gets done when Fullbay never
 *             carried the serial - but it is marked everywhere it appears,
 *             carries the serial it actually belongs to beside the one you
 *             are looking at, and says who decided and when.
 *
 * The flag lives on the DATA, not on the screen that happens to draw it.
 * A judgement pick that reaches an order sheet is still a judgement pick.
 */
import * as auth from './auth.js';
import * as store from './bookstore.js';
import { icon } from './icons.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const key = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

let DATA = null;

export async function load() {
  if (DATA) return DATA;
  const res = await fetch('./books.data.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('The book index did not load.');
  const d = await res.json();
  await store.load();
  DATA = d;
  return DATA;
}

/* The copy of this book that is in storage, if it has been put up. A book
   can be the right one and still not be uploaded yet - those are different
   facts and the screen says which. */
export function storedFor(book) {
  if (!book) return null;
  if (book.store) return store.byId(book.store);
  return store.forFolder(book.folder);
}

export function loaded() { return DATA; }

/* ---------- what book a machine gets ---------------------------------- */

export const STATE = {
  matched:   'Matched by serial',
  ambiguous: 'More than one book — somebody has to choose',
  hold:      'Held — a near-miss serial is not a match',
  nobook:    'No book in the libraries',
  noserial:  'No serial on the machine',
};

/* A saved judgement pick, if one exists, beats the registry's "no book" -
   but it never overrides a serial match. A machine whose serial is known
   and matched is not open to opinion. */
export function forMachine(machineId, picks) {
  const d = DATA || { machines: [] };
  const rec = (d.machines || []).find(m => m.id === machineId);
  if (!rec) return { state: 'nobook', how: 'none' };
  if (rec.state === 'matched') {
    return { state: 'matched', how: 'serial', book: rec.book, machine: rec,
             decidedBy: rec.decidedBy || '' };
  }
  /* The Epiroc books converted earlier were never in the Sandvik libraries
     the registry searched, so their machines read "no book". Where one of
     them carries EXACTLY this machine's serial it is a serial match by the
     same rule as any other - and only then, and only when it is the only
     one. A held or ambiguous machine is left for a person. */
  if (rec.state === 'nobook') {
    const ep = store.bySerial(rec.serial);
    if (ep.length === 1) {
      return { state: 'matched', how: 'serial', machine: rec, decidedBy: '',
               book: { lib: 'Epiroc', folder: ep[0].title, serial: ep[0].serial, store: ep[0].id } };
    }
  }
  const pick = (picks || {})[machineId];
  if (pick) return { state: rec.state, how: 'judgement', book: pick, machine: rec, pick };
  return { state: rec.state, how: 'none', machine: rec };
}

/* The sentence that must appear wherever a judgement pick is shown. It
   names BOTH serials, because that is the thing somebody has to see: the
   book in front of you belongs to a different machine. */
export function warning(view) {
  if (!view || view.how !== 'judgement') return '';
  const mine = (view.machine && view.machine.serial) || '';
  const theirs = (view.book && view.book.serial) || '';
  const who = (view.pick && view.pick.by) || '';
  const when = (view.pick && String(view.pick.at || '').slice(0, 10)) || '';
  return 'This is NOT this machine’s book. It is the book for '
    + (theirs ? 'serial ' + theirs : 'another machine')
    + (mine ? ', and this machine is ' + mine : ', and this machine has no serial recorded')
    + '. Chosen by ' + (who || 'somebody') + (when ? ' on ' + when : '')
    + '. Check every part number against the machine in front of you.';
}

/* ---------- the library ----------------------------------------------- */

export function library() { return (DATA && DATA.library) || []; }

/* Plain-language search over the folder names. Nobody looks a book up by
   its folder, so "pantera 1500" and "DP1500i" and a bare serial all have
   to find the same thing. */
export function find(q, limit) {
  const t = String(q || '').trim().toUpperCase();
  if (!t) return [];
  const words = t.split(/\s+/).filter(Boolean);
  const k = key(t);
  const rows = library();
  const scored = [];
  rows.forEach(r => {
    const hay = (r.folder + ' ' + r.lib).toUpperCase();
    const hk = key(r.serial);
    let score = 0;
    if (k && hk === k) score += 100;                       /* exact serial */
    else if (k && k.length >= 3 && hk.indexOf(k) === 0) score += 40;
    if (words.every(w => hay.indexOf(w) > -1)) score += 20;
    words.forEach(w => { if (hay.indexOf(w) > -1) score += 2; });
    if (score) scored.push({ ...r, score });
  });
  scored.sort((a, b) => b.score - a.score || a.folder.localeCompare(b.folder));
  return scored.slice(0, limit || 40);
}

/* Books for machines that look like this one, which is what somebody is
   reaching for when they say "it should be a DI550". */
export function like(machine, limit) {
  const t = String((machine && machine.model) || '').toUpperCase().replace(/\s+/g, '');
  const fam = ['PANTERA', 'LEOPARD', 'RANGER', 'TITON', 'SCOUT', 'DX900', 'DX800', 'DX700',
    'DX680', 'DX600', 'DI660', 'DI650', 'DI600', 'DI550', 'DP1500', 'DP1100']
    .find(f => t.indexOf(f) > -1);
  if (!fam) return [];
  return library().filter(r => r.family === fam).slice(0, limit || 60);
}

/* ---------- saving a judgement pick ----------------------------------- */

/* Looking is free; recording is a decision. Anybody who may see books can
   open one by judgement for themselves - that is somebody in a pit trying
   to get a machine running. Fixing it to the machine, so the next person
   inherits it, is an owner's act, because the next person will trust it. */
export async function savePick(machineId, book, note) {
  const me = auth.currentUser();
  if (!auth.allow('equipment.edit')) {
    throw new Error('Choosing a book FOR a machine is Mike and Stew — anyone can '
      + 'open one to look at.');
  }
  const rec = {
    folder: book.folder, lib: book.lib, serial: book.serial || '',
    how: 'judgement', by: me.name, at: new Date().toISOString(),
    note: String(note || '').trim(),
  };
  if (me.demo) {
    const all = localPicks();
    all[machineId] = rec;
    try { sessionStorage.setItem(PKEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
    return rec;
  }
  const { d, m } = await auth.db();
  await m.setDoc(m.doc(d, 'books', machineId), { machineId, ...rec });
  return rec;
}

const PKEY = 'bsds.bookPicks';
const localPicks = () => {
  try { return JSON.parse(sessionStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; }
};

export async function picks() {
  const me = auth.currentUser();
  if (!me) return {};
  if (me.demo) return localPicks();
  try {
    const { d, m } = await auth.db();
    const snap = await m.getDocs(m.collection(d, 'books'));
    const out = {};
    snap.docs.forEach(x => { out[x.id] = x.data(); });
    return out;
  } catch (e) { return {}; }
}

/* ---------- the coverage view ----------------------------------------- */

export function coverage(picksMap) {
  const d = DATA || { machines: [] };
  const out = { matched: [], judgement: [], ambiguous: [], hold: [], none: [] };
  (d.machines || []).forEach(m => {
    const v = forMachine(m.id, picksMap);
    if (v.how === 'serial') out.matched.push(m);
    else if (v.how === 'judgement') out.judgement.push(m);
    else if (m.state === 'ambiguous') out.ambiguous.push(m);
    else if (m.state === 'hold') out.hold.push(m);
    else out.none.push(m);
  });
  return out;
}

export { esc };

/* ---------- drawing --------------------------------------------------- */

/* The banner. It is red, it is first, and it names both serials. Anywhere
   a judgement pick is drawn, this goes above it - no exceptions, which is
   why every draw function below calls it rather than deciding for itself. */
export function banner(view) {
  const w = warning(view);
  if (!w) return '';
  return '<div class="note warn bookwarn"><b>NOT THIS MACHINE’S BOOK.</b> '
    + esc(w) + '</div>';
}

export function drawCoverage(host, cov, ctx) {
  const o = ctx || {};
  const n = a => a.length;
  const h = ['<div class="wrap">'];

  h.push('<div class="alerts">',
    tile('stop', n(cov.none) + n(cov.ambiguous) + n(cov.hold), 'machines with no book'),
    tile('note', n(cov.matched), 'matched by serial'),
    n(cov.judgement) ? tile('soon', n(cov.judgement), 'chosen by judgement') : '',
    '</div>');

  sec(h, 'Matched by serial', cov.matched,
    'The serial on the machine equals the serial on the book. Nothing else counts.');
  if (n(cov.judgement)) {
    sec(h, 'Chosen by judgement', cov.judgement,
      'Somebody picked these. They are not this machine’s book and every screen says so.');
  }
  if (n(cov.ambiguous)) {
    sec(h, 'More than one candidate', cov.ambiguous,
      'Two books carry this serial. Somebody who knows the machine has to choose.');
  }
  if (n(cov.hold)) {
    sec(h, 'Held — near-miss serials', cov.hold,
      'The library has a serial one digit away. One digit away is a different machine.');
  }
  sec(h, 'No book', cov.none,
    'Either no serial on the record, or no book in the libraries we hold.');

  h.push('</div>');
  host.innerHTML = h.join('');
}

const tile = (level, n, what) => '<button class="alert ' + level + '" data-go="equipment">'
  + '<span class="t">' + n + ' ' + esc(what) + '</span><span class="go">›</span></button>';

function sec(h, title, rows, blurb) {
  h.push('<h2 class="sec">', esc(title), ' (', rows.length, ')</h2>',
    '<p class="hint">', esc(blurb), '</p><div class="list">');
  if (!rows.length) h.push('<div class="empty">None.</div>');
  rows.forEach(m => h.push('<button class="row" data-bookfor="', esc(m.id), '"><span>',
    '<span class="nm">', esc(m.unit || m.id), '</span>',
    '<span class="sub">', esc(m.customer || ''), m.serial ? ' · s/n ' + esc(m.serial) : ' · no serial',
    m.model ? ' · ' + esc(m.model) : '', '</span></span>',
    '<span class="ct">›</span></button>'));
  h.push('</div>');
}

/* One machine: what book it has, or the way to choose one. */
export function drawForMachine(host, view, ctx) {
  const o = ctx || {};
  const m = view.machine || {};
  const h = ['<div class="wrap">'];

  h.push('<div class="sheet"><div class="head"><div><h1>', esc(m.unit || 'Machine'), '</h1>',
    '<p class="sub">', esc(m.customer || ''), m.serial ? ' · s/n ' + esc(m.serial) : ' · no serial on record',
    '</p></div><div class="stamp ', view.how === 'serial' ? 'pass' : 'fail', '">',
    view.how === 'serial' ? 'MATCHED' : (view.how === 'judgement' ? 'JUDGEMENT' : 'NO BOOK'),
    '</div></div>');

  h.push(banner(view));

  if (view.book) {
    h.push('<div class="grid">',
      cell('Book', view.book.folder), cell('Library', view.book.lib),
      cell('Book serial', view.book.serial), cell('How', STATE[view.state] || view.state),
      view.decidedBy ? cell('Decided by', view.decidedBy) : '',
      view.pick && view.pick.note ? cell('Why', view.pick.note) : '',
      '</div>');
    const s = storedFor(view.book);
    h.push(s
      ? '<div class="tiles" style="margin-top:14px"><button class="tile blue" data-openbook="'
        + esc(s.id) + '" data-for="' + esc(m.id || '') + '">' + icon('book')
        + '<span class="tx"><b>Open the book</b><span>'
        + (s.kind === 'pdf' ? esc(s.files) + ' PDFs' + (s.parts ? ' · part search' : '') : 'Converted book')
        + '</span></span></button></div>'
      : '<div class="note">This book is not in the app yet. Mike or Stew can put it up from '
        + 'the workstation — <code>node tools/stage_books.mjs --add "' + esc(view.book.folder)
        + '" --upload</code>.</div>');
  } else {
    h.push('<div class="note warn"><b>', esc(STATE[view.state] || 'No book'), '.</b> ',
      m.serial
        ? 'Nothing in the Sandvik libraries carries this serial.'
        : 'Fullbay has no serial for this machine, so there is nothing to match on.',
      ' Somebody who knows the machine can choose one below — it will be marked ',
      'as a judgement, not as this machine’s book.</div>');
  }
  h.push('</div>');

  if (o.canChoose) {
    h.push('<h2 class="sec">Choose one by judgement</h2><div class="panel">',
      '<p class="hint">Search the library — by model, by family, or by a serial you ',
      'think it should be. Whatever is chosen is marked on every screen it appears on.</p>',
      '<input id="bq" type="search" placeholder="pantera 1500, DI550, 58348" autocomplete="off">',
      '<div id="bhits"></div></div>');
  }
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawHits(host, rows, machineId) {
  if (!rows.length) {
    host.innerHTML = '<div class="empty">Nothing matches that.</div>';
    return;
  }
  const h = ['<div class="list">'];
  rows.forEach(r => h.push('<button class="row" data-pick="', esc(r.folder),
    '" data-for="', esc(machineId), '"><span><span class="nm">', esc(r.folder),
    '</span><span class="sub">', esc(r.lib), ' library',
    r.serial ? ' · s/n ' + esc(r.serial) : '', '</span></span>',
    '<span class="ct">Use this</span></button>'));
  h.push('</div>');
  host.innerHTML = h.join('');
}

const cell = (k, v) => v
  ? '<div class="c"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'
  : '';
