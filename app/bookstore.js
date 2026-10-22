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
const KEEP = 40;               /* files kept on a device before the oldest go */

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
  return list().find(b => b.kind === 'html' && b.ref === ref) || null;
}
/* Converted books whose serial is EXACTLY this one. Returns all of them so
   the caller can refuse when there is more than one - two books on a serial
   is a question for a person, not a coin toss. */
export function bySerial(serial) {
  const k = key(serial);
  if (!k) return [];
  return list().filter(b => b.kind === 'html' && key(b.serial) === k);
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
    const hit = await c.match(ck);
    if (hit) return hit.blob();
  }
  let b;
  try { b = await m.getBlob(ref); } catch (e) { throw friendly(e); }
  if (c) {
    try {
      /* drop older copies of this same file, then the oldest of the rest */
      const keys = await c.keys();
      const base = ck.split('?')[0];
      await Promise.all(keys.filter(r => r.url.split('?')[0] === base).map(r => c.delete(r)));
      const rest = (await c.keys());
      for (let i = 0; i <= rest.length - KEEP; i++) await c.delete(rest[i]);
      await c.put(ck, new Response(b, { headers: { 'content-type': meta.contentType || b.type || '' } }));
    } catch (e) { /* a full or blocked cache only costs a re-download */ }
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
export async function file(entry, rel) {
  const b = await fromBucket(objPath(entry, 'files/' + rel));
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
  const h = ['<div class="wrap">', o.banner || ''];
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
  (m.sections || []).forEach(s => {
    h.push('<h2 class="sec">', esc(s.title), ' (', s.files.length, ')</h2><div class="list">');
    s.files.forEach(f => h.push('<button class="row" data-bfile="', esc(f.p), '" data-book="',
      esc(entry.id), '"><span><span class="nm">', esc(f.t), '</span><span class="sub">',
      esc(f.p), ' · ', mb(f.b), '</span></span><span class="ct">Open</span></button>'));
    h.push('</div>');
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
      + esc(entry.id) + '"' : '', '><span><span class="nm">', esc(r[0]), ' — ', esc(r[1]),
      '</span><span class="sub">', esc(r[4] || ''), r[5] ? ' · qty ' + esc(r[5]) : '',
      r[6] ? ' · item ' + esc(r[6]) : '', '</span></span><span class="ct">',
      p ? 'Ch ' + esc(ch) + (r[7] ? ' p.' + esc(r[7]) : '') : 'no chapter',
      '</span></', p ? 'button' : 'div', '>');
  });
  h.push('</div>');
  host.innerHTML = h.join('');
}

/* A PDF, fetched and ready. The open is a real link the person taps, because
   a browser will not open a new tab on its own after a download - and on an
   iPhone the Save link is what hands it to the built-in viewer. */
export function drawFile(host, name, url, size, ctx) {
  const o = ctx || {};
  const wide = window.matchMedia && window.matchMedia('(min-width: 900px)').matches;
  host.innerHTML = ['<div class="wrap">', o.banner || '',
    '<div class="panel"><p class="hint">', esc(name), ' · ', mb(size), ' · on this device now</p>',
    '<div class="tiles">',
    '<a class="tile blue" href="', url, '" target="_blank" rel="noopener" id="bopen">',
    icon('book'), '<span class="tx"><b>Open</b><span>In the phone’s own viewer</span></span></a>',
    '<a class="tile muted" href="', url, '" download="', esc(name), '">',
    icon('out'), '<span class="tx"><b>Save</b><span>Keep a copy on this device</span></span></a>',
    '</div></div>',
    wide ? '<div class="pdfview"><iframe src="' + url + '" title="' + esc(name) + '"></iframe></div>' : '',
    '</div>'].join('');
}

/* A converted Epiroc book: a whole page with its own scripts. It is shown in
   a SEALED frame - scripts yes, but an opaque origin - so it cannot reach the
   app's sign-in, its database or its cached books. Its order tray still
   works; it just does not survive closing the book, which is the price. */
export function drawPage(host, html, title, ctx) {
  const o = ctx || {};
  host.innerHTML = '<div class="frame' + (o.banner ? ' withbanner' : '') + '">'
    + (o.banner ? '<div class="framebanner">' + o.banner + '</div>' : '')
    + '<iframe sandbox="allow-scripts allow-popups allow-downloads allow-modals" title="'
    + esc(title) + '" referrerpolicy="no-referrer"></iframe></div>';
  host.querySelector('iframe').srcdoc = html;
}
