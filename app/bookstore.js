/* The parts books that live in Cloud Storage, and opening them.
 *
 * books.js decides WHICH book a machine gets. This file only fetches and
 * shows one. Keeping those apart is the point: nothing in here may ever
 * soften the serial rule, and nothing in books.js needs to know where a PDF
 * comes from.
 *
 * What is in the bucket is listed in books.stored.json, written by
 * tools/stage_books.mjs on the workstation that did the upload. Titles and
 * paths only - the content itself is behind sign-in (storage.rules).
 *
 * Every fetch goes through the Storage SDK so it carries the user's sign-in.
 * There is deliberately no getDownloadURL anywhere: a download URL is a
 * bearer link that works for whoever it is pasted to.
 *
 * Fetched files are kept on the device in Cache Storage, keyed by the
 * object's generation, so a book opened at the shop opens again on the deck
 * without another 20 MB over one bar of signal - and a re-uploaded book is
 * fetched fresh. Signing out clears it (auth.js).
 */
import { DEMO } from './config.js';
import * as auth from './auth.js';
import { icon } from './icons.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const key = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/* In the preview there is no bucket; the test harness stands one in here. */
const DEMO_BASE = './books-demo/';
const CACHE = 'bsds-books';
/* What a phone keeps is capped by SIZE, not by count: 300 MB, and the book
   opened longest ago goes first. A single file bigger than 120 MB is shown
   but not kept - one of those would push out everything else. The sizes and
   last-opened times live in a small list beside the cache (CIDX), because
   the cache itself cannot say when something was last used. */
export const CAP = 300 * 1048576;
const MAXONE = 120 * 1048576;
const CIDX = 'bsds.bookCache';

function cidx() { try { return JSON.parse(localStorage.getItem(CIDX) || '{}') || {}; } catch (e) { return {}; } }
function keepCidx(x) { try { localStorage.setItem(CIDX, JSON.stringify(x)); } catch (e) {} }

/* How much this phone is holding, by the list. */
export function kept() {
  const x = cidx();
  return Object.keys(x).reduce((s, k) => s + (x[k].b || 0), 0);
}
export async function clearKept() {
  try { if (self.caches) await caches.delete(CACHE); } catch (e) {}
  try { localStorage.removeItem(CIDX); } catch (e) {}
}

export async function cacheGet(c, ck) {
  const hit = await c.match(ck);
  if (!hit) return null;
  const x = cidx();
  if (x[ck]) { x[ck].t = Date.now(); keepCidx(x); }
  return hit.blob();
}

/* `lim` is only for the test, which cannot fill a phone with 300 MB to prove
   the cap; the app always uses CAP and MAXONE. */
export async function cachePut(c, ck, blob, type, lim) {
  const cap = (lim && lim.cap) || CAP;
  if (blob.size > ((lim && lim.maxOne) || MAXONE)) return;
  const x = cidx();
  /* an older copy of this same file (it was re-uploaded) goes first */
  const base = ck.split('?')[0];
  for (const k of Object.keys(x)) {
    if (k.split('?')[0] === base && k !== ck) { await c.delete(k); delete x[k]; }
  }
  /* then the least recently opened, until the new one fits under the cap */
  let total = Object.keys(x).reduce((s, k) => s + (x[k].b || 0), 0);
  const oldest = Object.keys(x).sort((a, b) => (x[a].t || 0) - (x[b].t || 0));
  while (total + blob.size > cap && oldest.length) {
    const k = oldest.shift();
    await c.delete(k);
    total -= x[k].b || 0;
    delete x[k];
  }
  await c.put(ck, new Response(blob, { headers: { 'content-type': type || '' } }));
  x[ck] = { b: blob.size, t: Date.now() };
  keepCidx(x);
}

let LIST = null;

export async function load() {
  if (LIST) return LIST;
  try {
    const res = await fetch('./books.stored.json', { cache: 'no-cache' });
    LIST = res.ok ? ((await res.json()).books || []) : [];
  } catch (e) { LIST = []; }
  return LIST;
}
export function list() { return LIST || []; }
export function byId(id) { return list().find(b => b.id === id) || null; }

/* The stored copy of a library book, matched on its folder name exactly. */
export function forFolder(folder) {
  return list().find(b => b.kind === 'pdf' && b.folder === folder) || null;
}
/* The stored copy of an Epiroc book listed in config.js. */
export function forRef(ref) {
  return list().find(b => b.kind === 'html' && !b.shelf && b.ref === ref) || null;
}
/* The stored copy of a schematics or manuals page from config.shelves. */
export function forShelf(ref) {
  return list().find(b => b.shelf && b.ref === ref) || null;
}
/* Converted books whose serial is EXACTLY this one. Returns all of them so
   the caller can refuse when there is more than one - two books on a serial
   is a question for a person, not a coin toss. */
export function bySerial(serial) {
  const k = key(serial);
  if (!k) return [];
  return list().filter(b => b.kind === 'html' && !b.shelf && key(b.serial) === k);
}

/* ---------- fetching ---------------------------------------------------- */

const objPath = (entry, rel) => 'books/' + entry.id + '/' + rel;

async function fromBucket(p) {
  if (DEMO) {
    const res = await fetch(DEMO_BASE + p);
    if (!res.ok) throw new Error('Books open from storage once the app is signed in for real.');
    return res.blob();
  }
  const { st, m } = await auth.storage();
  const ref = m.ref(st, p);
  let meta = null;
  try { meta = await m.getMetadata(ref); } catch (e) { throw friendly(e); }
  const ck = 'https://books.bsds.local/' + p + '?g=' + (meta.generation || meta.updated || '');
  let c = null;
  try { c = self.caches ? await caches.open(CACHE) : null; } catch (e) { c = null; }
  if (c) {
    try { const hit = await cacheGet(c, ck); if (hit) return hit; } catch (e) { /* fetch it */ }
  }
  let b;
  try { b = await m.getBlob(ref); } catch (e) { throw friendly(e); }
  if (c) {
    try { await cachePut(c, ck, b, meta.contentType || b.type); }
    catch (e) { /* a full or blocked cache only costs a re-download */ }
  }
  return b;
}

function friendly(e) {
  const c = (e && e.code) || '';
  if (c.includes('object-not-found')) return new Error('That file is not in storage. The book may still be uploading.');
  if (c.includes('unauthorized') || c.includes('unauthenticated')) return new Error('Your account cannot open books. Ask Mike or Stew.');
  if (c.includes('retry-limit') || c.includes('network')) return new Error('No signal good enough to fetch it. Try again where there is.');
  return e instanceof Error ? e : new Error(String(e));
}

export async function manifest(entry) {
  return JSON.parse(await (await fromBucket(objPath(entry, 'manifest.json'))).text());
}
export async function index(entry) {
  return JSON.parse(await (await fromBucket(objPath(entry, 'index.json'))).text());
}
/* A file the CDs share (the same Cat manual on six of them) is kept once, in
   one book; the manifest says where with `o`. Reading it by that one path
   also means the phone keeps one copy for every rig that uses it. */
export function fileEntry(m, rel) {
  let hit = null;
  ((m && m.sections) || []).forEach(s => s.files.forEach(f => { if (f.p === rel) hit = f; }));
  return hit;
}
export async function file(entry, rel, m) {
  const f = fileEntry(m, rel);
  const b = await fromBucket(f && f.o ? 'books/' + f.o : objPath(entry, 'files/' + rel));
  /* Storage may hand it back untyped; a PDF viewer needs to be told. */
  return /\.pdf$/i.test(rel) && b.type !== 'application/pdf' ? new Blob([b], { type: 'application/pdf' }) : b;
}
export async function page(entry, m) {
  return (await fromBucket(objPath(entry, (m && m.file) || 'book.html'))).text();
}

/* ---------- part search -------------------------------------------------- */

/* A part number, part of one, or words off the description or assembly.
   An exact part number goes first; a near one is still listed, because here
   it is a search, not a match - the drawing is what confirms it. */
export function search(idx, q, limit) {
  const t = String(q || '').trim().toUpperCase();
  if (!t || !idx || !idx.rows) return [];
  const k = key(t);
  const words = t.split(/\s+/).filter(Boolean);
  const out = [];
  idx.rows.forEach(r => {
    const pk = key(r[0]);
    let s = 0;
    if (k && pk === k) s = 100;
    else if (k.length >= 4 && pk.indexOf(k) === 0) s = 50;
    else if (k.length >= 5 && pk.indexOf(k) > 0) s = 30;
    const hay = (r[1] + ' ' + r[4]).toUpperCase();
    if (words.every(w => hay.indexOf(w) > -1)) s += 10;
    if (s) out.push({ r, s });
  });
  out.sort((a, b) => b.s - a.s || a.r[0].localeCompare(b.r[0]));
  return out.slice(0, limit || 50).map(x => x.r);
}

/* ---------- drawing ---------------------------------------------------- */

const mb = b => (b / 1048576 < 1 ? '<1' : Math.round(b / 1048576)) + ' MB';

/* The contents of one book. `banner` is books.banner(view) - passed in, not
   decided here, so a judgement pick is marked the same way on every screen. */
export function drawBook(host, entry, m, ctx) {
  const o = ctx || {};
  const h = ['<div class="wrap">', o.banner || '', basketBar()];
  h.push('<div class="sheet"><div class="head"><div><h1>', esc(m.title), '</h1>',
    '<p class="sub">', esc(m.lib), ' library', m.serial ? ' · s/n ' + esc(m.serial) : '',
    '</p></div></div></div>');
  if (m.parts) {
    h.push('<h2 class="sec">Find a part</h2><div class="panel">',
      '<p class="hint">Part number, or words off the drawing. ', m.parts.toLocaleString(),
      ' lines in this book’s index. Check the number against the drawing before ordering.</p>',
      '<input id="bpq" type="search" placeholder="00302748, towing eye, pin" autocomplete="off"',
      ' data-book="', esc(entry.id), '"><div id="bphits"></div></div>');
  } else {
    h.push('<p class="hint">This book has no part index, so look parts up chapter by chapter.</p>');
  }
  /* Spare parts open; manuals folded until tapped; the CD's own paperwork in
     one closed pile at the bottom. Older manifests carry no `show`, so they
     fall back to the same rule by folder. */
  const rowsOf = s => s.files.map(f => '<button class="row" data-bfile="' + esc(f.p) + '" data-book="'
    + esc(entry.id) + '"><span><span class="nm">' + esc(f.t) + '</span><span class="sub">'
    + esc(f.p) + ' · ' + mb(f.b) + '</span></span><span class="ct">Open</span></button>').join('');
  const show = s => s.show || (s.key === 'sp' ? 'open' : (s.key === 'info' || !s.key) ? 'papers' : 'fold');
  const secs = (m.sections || []).slice()
    .sort((a, b) => ['open', 'fold', 'papers'].indexOf(show(a)) - ['open', 'fold', 'papers'].indexOf(show(b)));
  const folded = secs.filter(s => show(s) !== 'open');
  secs.filter(s => show(s) === 'open').forEach(s => {
    h.push('<h2 class="sec">', esc(s.title), ' (', s.files.length, ')</h2><div class="list">', rowsOf(s), '</div>');
  });
  if (folded.length) h.push('<h2 class="sec">Manuals and the rest</h2>');
  folded.forEach(s => {
    h.push('<details class="bsec', show(s) === 'papers' ? ' papers' : '', '"><summary><span>',
      esc(s.title), '</span><b>', s.files.length, '</b></summary><div class="list">', rowsOf(s), '</div></details>');
  });
  h.push('</div>');
  host.innerHTML = h.join('');
}

export function drawHits(host, rows, entry, m) {
  if (!rows.length) { host.innerHTML = '<div class="empty">Nothing in the index matches that.</div>'; return; }
  const have = {};
  (m.sections || []).forEach(s => s.files.forEach(f => { if (f.ch) have[f.ch] = f.p; }));
  const h = ['<div class="list">'];
  rows.forEach(r => {
    const ch = String(r[2] || '').padStart(2, '0');
    const p = have[ch];
    h.push('<', p ? 'button' : 'div', ' class="row"', p ? ' data-bfile="' + esc(p) + '" data-book="'
      + esc(entry.id) + '" data-part="' + esc(r[0]) + '"' : '', '><span><span class="nm">', esc(r[0]), ' — ', esc(r[1]),
      '</span><span class="sub">', esc(r[4] || ''), r[5] ? ' · qty ' + esc(r[5]) : '',
      r[6] ? ' · item ' + esc(r[6]) : '', '</span></span><span class="ct">',
      p ? 'Ch ' + esc(ch) + (r[7] ? ' p.' + esc(r[7]) : '') : 'no chapter',
      '</span></', p ? 'button' : 'div', '>');
  });
  h.push('</div>');
  host.innerHTML = h.join('');
}

/* ---------- the page viewer --------------------------------------------- */

/* A chapter is shown IN the app, page by page, because a phone's own PDF
   viewer always opens on page 1 - the contents - and ignores any "go to page"
   it is handed. Searched from a part number, it opens on the page that part
   is printed on, with the number marked, and the drawing is a flick away.

   pdf.js comes from jsDelivr, pinned, in its "legacy" build so an older
   iPhone can run it. If it cannot load - no signal, an old browser - the
   Open and Save links are already on the screen and still work. */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
let pdfjsP = null;
function pdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsP) {
    pdfjsP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'legacy/build/pdf.min.js';
      s.onload = () => {
        const L = window.pdfjsLib;
        if (!L) { rej(new Error('no viewer')); return; }
        L.GlobalWorkerOptions.workerSrc = PDFJS + 'legacy/build/pdf.worker.min.js';
        res(L);
      };
      s.onerror = () => { pdfjsP = null; rej(new Error('The page viewer did not load.')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsP;
}

let VIEW = 0;               /* bumped on every open, so a stale search stops */

export async function openPdf(host, blob, url, opts) {
  const o = opts || {};
  const me = ++VIEW;
  const part = String(o.part || '').trim();
  const pk = key(part);
  host.innerHTML = ['<div class="wrap">', o.banner || '',
    '<div class="pdfbar">',
    '<button type="button" class="pvbtn" id="pvprev" aria-label="Previous page" disabled>‹</button>',
    '<span id="pvpos">Loading…</span>',
    '<button type="button" class="pvbtn" id="pvnext" aria-label="Next page" disabled>›</button>',
    '</div>',
    '<p class="hint" id="pvmsg">', part ? 'Looking for ' + esc(part) + '…' : '', '</p>',
    part ? '<div class="pagebar"><button type="button" class="btn primary" id="pvadd">+ Add '
      + esc(part) + ' to a parts request</button><span id="pvbasket">' + basketBar() + '</span></div>'
      : '<span id="pvbasket">' + basketBar() + '</span>',
    '<div class="pdfpage" id="pvpage"><canvas id="pvcanvas"></canvas></div>',
    '<p class="hint">', esc(o.name || ''), ' · ', mb(blob.size),
    ' · kept on this device. Pinch to zoom.</p>',
    '<div class="tiles">',
    '<a class="tile muted" href="', url, '" target="_blank" rel="noopener" id="bopen">',
    icon('book'), '<span class="tx"><b>Open</b><span>In the phone’s own viewer (starts at page 1)</span></span></a>',
    '<a class="tile muted" href="', url, '" download="', esc(o.name || 'book.pdf'), '">',
    icon('out'), '<span class="tx"><b>Save</b><span>Keep a copy on this device</span></span></a>',
    '</div></div>'].join('');

  const $ = id => host.querySelector('#' + id);
  const msg = t => { const m = $('pvmsg'); if (m) m.innerHTML = t; };
  if (part) {
    $('pvadd').onclick = () => {
      const b = basketAdd([{ pn: part, qty: 1, desc: o.desc || '' }], o.unit || '');
      const l = b.lines.find(x => key(x.pn) === pk);
      $('pvadd').textContent = '✓ Added' + (l && l.qty > 1 ? ' — ' + l.qty + ' of them' : '')
        + '. Tap again for one more.';
      $('pvbasket').innerHTML = basketBar();
    };
  }
  let doc;
  try {
    const L = await pdfjs();
    doc = await L.getDocument({ data: new Uint8Array(await blob.arrayBuffer()),
      standardFontDataUrl: PDFJS + 'standard_fonts/' }).promise;
  } catch (e) {
    if (me === VIEW) {
      $('pvpos').textContent = '';
      msg('<b>Could not show the pages here.</b> Use Open or Save below'
        + (part ? ', and look for ' + esc(part) + ' in it.' : '.'));
    }
    return;
  }
  if (me !== VIEW) return;

  const n = doc.numPages;
  let cur = 1;
  let task = null;
  const hits = [];

  async function render(i) {
    cur = Math.max(1, Math.min(n, i));
    $('pvpos').textContent = 'Page ' + cur + ' of ' + n;
    $('pvprev').disabled = cur <= 1;
    $('pvnext').disabled = cur >= n;
    const page = await doc.getPage(cur);
    if (me !== VIEW) return;
    const box = $('pvpage');
    const cv = $('pvcanvas');
    const cssW = Math.max(280, box.clientWidth || 360);
    const base = page.getViewport({ scale: 1 });
    /* drawn sharper than the screen, so a pinch-zoom on a drawing still
       reads - capped, because a phone has only so much memory */
    const px = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5), 3200 / cssW);
    const vp = page.getViewport({ scale: (cssW / base.width) * px });
    if (task) { try { task.cancel(); } catch (e) {} }
    cv.width = Math.floor(vp.width);
    cv.height = Math.floor(vp.height);
    cv.style.width = cssW + 'px';
    cv.style.height = Math.floor(vp.height / px) + 'px';
    const g = cv.getContext('2d');
    task = page.render({ canvasContext: g, viewport: vp });
    try { await task.promise; } catch (e) { return; }   /* cancelled by a newer page */
    if (!pk || me !== VIEW) return;
    /* mark the part number where it is printed */
    const tc = await page.getTextContent();
    g.save();
    g.fillStyle = 'rgba(232,100,28,.28)';
    g.strokeStyle = '#e8641c';
    g.lineWidth = Math.max(2, px * 1.5);
    tc.items.forEach(it => {
      if (key(it.str).indexOf(pk) < 0) return;
      const t = it.transform;
      const h = it.height || Math.hypot(t[2], t[3]) || 10;
      /* the text box runs from just under the baseline to the cap height */
      const r = vp.convertToViewportRectangle([t[4], t[5] - h * 0.22, t[4] + it.width, t[5] + h * 0.78]);
      const x = Math.min(r[0], r[2]) - 3 * px, y = Math.min(r[1], r[3]) - 1.5 * px;
      const w = Math.abs(r[2] - r[0]) + 6 * px, hh = Math.abs(r[3] - r[1]) + 3 * px;
      g.fillRect(x, y, w, hh);
      g.strokeRect(x, y, w, hh);
    });
    g.restore();
  }

  $('pvprev').onclick = () => render(cur - 1);
  $('pvnext').onclick = () => render(cur + 1);

  if (!pk) { msg(''); await render(1); return; }

  /* Find the part. The first page it is on is drawn straight away; the rest
     of the chapter is still searched so the other places it appears can be
     listed - a part is often on the parts list AND a kit. */
  let first = true;
  for (let i = 1; i <= n; i++) {
    if (me !== VIEW) return;
    if (first && i % 5 === 1) msg('Looking for ' + esc(part) + '… page ' + i + ' of ' + n);
    let txt = '';
    try { txt = (await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join(' '); }
    catch (e) { continue; }
    if (key(txt).indexOf(pk) < 0) continue;
    hits.push(i);
    if (first) { first = false; await render(i); }
    showHits();
  }
  if (me !== VIEW) return;
  if (!hits.length) {
    msg('<b>' + esc(part) + ' is not printed in this chapter.</b> The index may point at a '
      + 'kit or an assembly that lists it differently — check the contents page.');
    await render(1);
  } else showHits(true);

  function showHits(done) {
    const others = hits.filter(h => h !== cur);
    msg('<b>' + esc(part) + '</b> is on page ' + hits.map(h => h === cur ? '<b>' + h + '</b>'
      : '<button type="button" class="pvjump" data-pg="' + h + '">' + h + '</button>').join(', ')
      + (done ? '' : ' (still looking…)')
      + '. If the drawing is not on this page, it is on the one before — tap ‹.');
    host.querySelectorAll('.pvjump').forEach(b => { b.onclick = () => { render(+b.dataset.pg); showHits(done); }; });
  }
}

/* ---------- parts to order ----------------------------------------------
   What somebody has picked out of a book, waiting to go on a parts request.
   Kept for the visit only (sessionStorage): it is a shopping list, not a
   record - the record is the request it becomes. */
const BKEY = 'bsds.partsBasket';
export function basket() {
  try { return JSON.parse(sessionStorage.getItem(BKEY) || 'null') || { unit: '', lines: [] }; }
  catch (e) { return { unit: '', lines: [] }; }
}
function keepBasket(b) { try { sessionStorage.setItem(BKEY, JSON.stringify(b)); } catch (e) {} }
export function basketClear() { try { sessionStorage.removeItem(BKEY); } catch (e) {} }
/* Same part twice adds to the quantity rather than making a second line. */
export function basketAdd(lines, unit) {
  const b = basket();
  if (unit && !b.unit) b.unit = unit;
  (lines || []).forEach(l => {
    const pn = String(l.pn || '').trim();
    const desc = String(l.desc || '').trim();
    if (!pn && !desc) return;
    const qty = Math.max(1, Number(l.qty) || 1);
    const at = b.lines.find(x => pn ? key(x.pn) === key(pn) : (!x.pn && x.desc === desc));
    if (at) at.qty = (Number(at.qty) || 0) + qty;
    else b.lines.push({ pn, qty, desc });
  });
  keepBasket(b);
  return b;
}
export function basketBar() {
  const n = basket().lines.length;
  return n ? '<button type="button" class="basketbar" data-go="parts"><b>' + n + ' part'
    + (n === 1 ? '' : 's') + ' to order</b><span>Put them on a parts request ›</span></button>' : '';
}

/* A converted Epiroc book: a whole page with its own scripts. It is shown in
   a SEALED frame - scripts yes, but an opaque origin - so it cannot reach the
   app's sign-in, its database or its cached books.

   That seal is also why its own order tray could not get out: it saves by
   download, by clipboard, or through claude.ai's save - and none of those
   reach out of a sealed frame. So a small helper is put into the page that
   does two things, and only by message to the app around it:
     - hands over the tray, read through the book's own orderRows(), when the
       app asks - that is the "send to a parts request" button;
     - passes the book's order-sheet file up for the app to save.
   The book still cannot read anything of the app's; it can only send. */
/* Some books (70165) keep all their code private, so their orderRows() cannot
   be called from outside. Every book saves its tray to localStorage on each
   tap, though - which a sealed frame refuses. The helper stands in an
   in-memory store, so the save succeeds and the tray can be read from it. */
const SHIM = '<script>(function(){'
  + 'var mem={},ls={getItem:function(k){return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null},'
  + 'setItem:function(k,v){mem[k]=String(v)},removeItem:function(k){delete mem[k]},'
  + 'clear:function(){mem={}},key:function(i){return Object.keys(mem)[i]||null}};'
  + 'Object.defineProperty(ls,"length",{get:function(){return Object.keys(mem).length}});'
  + 'try{Object.defineProperty(window,"localStorage",{configurable:true,get:function(){return ls}})}catch(e){}'
  + 'function stored(){var out=[];Object.keys(mem).forEach(function(k){try{var o=JSON.parse(mem[k]);'
  + 'if(o&&o.tray&&o.tray.length&&o.tray[0].pn!==undefined){var u=(o.who&&o.who.unit)||"";'
  + 'o.tray.forEach(function(t){out.push([t.pn,t.q,t.nm||"",u])})}}catch(e){}});return out}'
  + 'function up(m){try{parent.postMessage(m,"*")}catch(e){}}'
  + 'function save(name,data){up({bsds:"save",filename:name,data:data})}'
  + 'window.claude={use:function(n){return n==="downloads"?Promise.resolve({save:function(o){'
  + 'save(o.filename,o.data);return Promise.resolve()}}):Promise.reject(new Error("none"))}};'
  + 'addEventListener("load",function(){try{if(window.XLSX&&XLSX.writeFile){'
  + 'XLSX.writeFile=function(wb,name){save(name,XLSX.write(wb,{bookType:"xlsx",type:"array"}))}}}catch(e){}});'
  + 'addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.bsds!=="tray?")return;'
  + 'var rows=[],cols=[];try{rows=orderRows();cols=COLS}catch(x){}'
  + 'if(!rows.length){rows=stored();cols=["Part number","Qty","Description","Unit"]}'
  + 'up({bsds:"tray",cols:cols,rows:rows})});'
  + '})();</script>';

export function withShim(html) {
  const s = String(html || '');
  const m = s.match(/<head[^>]*>/i);
  return m ? s.replace(m[0], m[0] + SHIM) : SHIM + s;
}

/* The book's rows, by its own column names, as request lines. Where a book
   carries an Epiroc order number beside the number printed in it, the order
   number is the one to order by. */
export function trayLines(cols, rows) {
  const at = name => (cols || []).findIndex(c => String(c).toLowerCase() === name);
  const iOrd = at('order number');
  const iPn = iOrd >= 0 ? iOrd : at('part number') >= 0 ? at('part number') : at('part number in book');
  const iQty = at('qty'), iDesc = at('description'), iUnit = at('unit');
  let unit = '';
  const lines = (rows || []).map(r => {
    if (iUnit >= 0 && r[iUnit] && !unit) unit = String(r[iUnit]);
    return { pn: iPn >= 0 ? r[iPn] : '', qty: iQty >= 0 ? r[iQty] : 1, desc: iDesc >= 0 ? r[iDesc] : '' };
  }).filter(l => l.pn || l.desc);
  return { lines, unit };
}

let FRAME = null;          /* the book frame on screen, the only one listened to */
let onTray = null;

if (typeof window !== 'undefined') {
  window.addEventListener('message', e => {
    if (!FRAME || e.source !== FRAME.contentWindow || !e.data) return;
    const d = e.data;
    if (d.bsds === 'tray' && onTray) { const f = onTray; onTray = null; f(d); return; }
    if (d.bsds === 'save' && d.data) {
      const name = String(d.filename || 'Parts order.xlsx').replace(/[\\/:*?"<>|]+/g, ' ');
      const url = URL.createObjectURL(new Blob([d.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });
}

/* Ask the book on screen for its tray. */
export function askTray(timeout) {
  return new Promise((res, rej) => {
    if (!FRAME) { rej(new Error('No book is open.')); return; }
    const t = setTimeout(() => { onTray = null; rej(new Error('The book did not answer.')); }, timeout || 4000);
    onTray = d => { clearTimeout(t); res(d); };
    FRAME.contentWindow.postMessage({ bsds: 'tray?' }, '*');
  });
}

export function drawPage(host, html, title, ctx) {
  const o = ctx || {};
  /* a manual or schematic has no parts tray, so no button that would find none */
  const bar = o.noTray ? '' : '<div class="pagebar"><button type="button" class="btn primary" id="pgsend">'
    + 'Send this book’s list to a parts request</button>' + basketBar() + '</div>';
  const top = (o.banner || '') + bar;
  host.innerHTML = '<div class="frame' + (top ? ' withbanner' : '') + '">'
    + (top ? '<div class="framebanner">' + top + '</div>' : '')
    + '<iframe sandbox="allow-scripts allow-popups allow-downloads allow-modals" title="'
    + esc(title) + '" referrerpolicy="no-referrer"></iframe></div>';
  FRAME = host.querySelector('iframe');
  FRAME.srcdoc = withShim(html);
}
