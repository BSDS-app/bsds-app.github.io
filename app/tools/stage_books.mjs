/* Puts parts books into Cloud Storage.
 *
 * Run on the workstation that holds the Toolman libraries (the D: drive).
 * Never from a phone, never from the app - the bucket is read-only to the
 * app on purpose (storage.rules).
 *
 *   node tools/stage_books.mjs                 build the staging folder
 *   node tools/stage_books.mjs --upload        build it, then send it up
 *   node tools/stage_books.mjs --add "Leopard DI550 S5 60673" --upload
 *                                              also put up one more library
 *                                              book - the way a judgement
 *                                              pick gets its book into the app
 *
 * WHAT GOES UP, AND WHAT DOES NOT
 *   - Every machine MATCHED BY SERIAL in books.data.json, plus any --add.
 *     Not the whole 255 GB library: 647 books nobody has asked for is a
 *     bill and a week of uploading for nothing.
 *   - From each Toolman book, the PDFs only. The .exe, .dll and installer
 *     files are the old CD viewer; they are useless in a browser and some of
 *     them are programs, which have no business in a bucket.
 *   - fscommand/ is skipped entirely - it is the CD's own plumbing.
 *   - The Epiroc books converted earlier (staged under <books>/epiroc/<id>)
 *     go up as one HTML file each. 70165's drawings are folded into the page
 *     so the app can show it without a second round trip per drawing.
 *
 * WHERE THINGS LAND
 *   staging:  <books>/staging/<slug>/...      (default C:\Users\cluna\Downloads\bsds-books)
 *   bucket:   gs://<storageBucket>/books/<slug>/...
 *   the app:  books.stored.json, next to this repo's index.html. It lists
 *             what is in the bucket - titles and paths only, no content -
 *             so the app knows which books open in place.
 *
 * The staging folder sits OUTSIDE the repo deliberately. The repo is a public
 * GitHub Pages site; a book copied into it is a book published to the world.
 *
 * Uploading is `gcloud storage rsync`, which is resumable: if the connection
 * drops, run the same command again and it carries on where it stopped.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOOKS = process.env.BSDS_BOOKS_DIR || 'C:\\Users\\cluna\\Downloads\\bsds-books';

/* ---------- small helpers, exported for the test ------------------------ */

export const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* What each Toolman folder is, in the words a tech would use. Order is the
   order they are listed in the app: parts first, because that is why anyone
   opens a parts book. */
/* The third column is how the app shows it: spare parts open, the manuals
   folded until tapped, and the CD's own paperwork - warranties, feedback
   forms, help for the old CD viewer, its contents pages - in one closed
   "other papers" pile at the bottom. Nothing is dropped; it is just out of
   the way of the thing people came for. */
export const SECTIONS = [
  ['sp', 'Spare parts', 'open'],
  ['ws', 'Workshop', 'fold'],
  ['ma', 'Maintenance', 'fold'],
  ['op', 'Operator', 'fold'],
  ['cat', 'Engine (Cat)', 'fold'],
  ['rocktools', 'Rock tools', 'fold'],
  ['info', 'Other papers — warranty, safety notices, CD help', 'papers'],
];

/* The Toolman part index. One line per part per assembly:
 *   @partNo@pos@description@chapter@assemblyNo@assemblyName@qty@
 * The chapter is the spare-parts PDF it lives in (16 -> sp/16.pdf), which is
 * the whole value of it: a part number goes straight to the right chapter
 * instead of somebody paging through fourteen of them. */
/* Older books (the 110T15405-1 CD) write the same thing tab-separated, with
   the chapter as "11-94": chapter 11, page 94 of it. Both are read; the page
   is kept when there is one, because it saves paging through the chapter. */
export function parseIndex(text) {
  const seen = new Set();
  const rows = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    let f;
    if (line.startsWith('@')) f = line.split('@').slice(1);
    else if (line.includes('\t')) f = line.split('\t');
    else return;
    if (f.length < 7) return;
    const [part, pos, desc, where, asmNo, asmName, qty] = f.map(x => String(x || '').trim());
    if (!part) return;
    const [chapter, pg] = where.split('-');
    const row = [part, desc, chapter || '', asmNo, asmName, qty, pos, pg || ''];
    const k = row.join('\u0001');
    if (seen.has(k)) return;          /* the index repeats itself; keep one */
    seen.add(k);
    rows.push(row);
  });
  return rows;
}

/* A spare-parts chapter is a number on disk. Name it after the assemblies
   the index puts in it, most-listed first, so "04" reads as something. */
export function chapterTitles(rows) {
  const by = {};
  rows.forEach(r => {
    const ch = r[2].padStart(2, '0');
    if (!r[4]) return;
    (by[ch] = by[ch] || {})[r[4]] = ((by[ch] || {})[r[4]] || 0) + 1;
  });
  const out = {};
  Object.keys(by).forEach(ch => {
    out[ch] = Object.entries(by[ch]).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(e => e[0]).join(' · ');
  });
  return out;
}

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = (base ? base + '/' : '') + e.name;
    if (e.isDirectory()) walk(full, rel, out);
    else out.push({ full, rel, size: fs.statSync(full).size });
  }
  return out;
}

/* A Toolman book is either laid out at the top of its folder or one level
   down in a folder named for the serial. The real root is whichever one
   holds the spare-parts folder. */
export function toolmanRoot(folder) {
  if (fs.existsSync(path.join(folder, 'sp'))) return folder;
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(folder, e.name, 'sp'))) {
      return path.join(folder, e.name);
    }
  }
  return null;
}

/* Everything about one Toolman book except copying it. */
export function planToolman(folder, meta) {
  const root = toolmanRoot(folder);
  if (!root) throw new Error('No spare-parts folder in ' + folder);
  const files = walk(root, '', [])
    .filter(f => /\.pdf$/i.test(f.rel))
    .filter(f => !/^fscommand\//i.test(f.rel))
    .filter(f => !/^xtras\//i.test(f.rel));

  let rows = [];
  const idxDir = path.join(root, 'Indexlist');
  if (fs.existsSync(idxDir)) {
    fs.readdirSync(idxDir).filter(n => /\.txt$/i.test(n)).forEach(n => {
      rows = rows.concat(parseIndex(fs.readFileSync(path.join(idxDir, n), 'latin1')));
    });
  }
  const chapters = chapterTitles(rows);

  const sections = SECTIONS.map(([key, title, show]) => ({ key, title, show, files: [] }));
  const other = sections.find(s => s.key === 'info');
  files.forEach(f => {
    const top = f.rel.includes('/') ? f.rel.split('/')[0].toLowerCase() : '';
    const sec = sections.find(s => s.key && s.key === top) || other;
    const name = path.basename(f.rel, path.extname(f.rel));
    let t = name;
    const ch = /^\d{1,2}$/.test(name) ? name.padStart(2, '0') : '';
    if (top === 'sp' && ch) t = 'Chapter ' + ch + (chapters[ch] ? ' — ' + chapters[ch] : '');
    sec.files.push({ p: f.rel, t, b: f.size, ch: top === 'sp' && ch ? ch : undefined });
  });
  sections.forEach(s => s.files.sort((a, b) => a.p.localeCompare(b.p, 'en', { numeric: true })));

  return {
    root,
    files,
    manifest: {
      v: 1, kind: 'pdf', id: meta.id, title: meta.title, lib: meta.lib,
      folder: meta.folder, serial: meta.serial || '',
      builtAt: new Date().toISOString().slice(0, 10),
      sections: sections.filter(s => s.files.length),
      parts: rows.length,
    },
    index: rows.length ? { v: 1, cols: ['part', 'desc', 'chapter', 'asmNo', 'asm', 'qty', 'pos', 'page'], rows } : null,
  };
}

/* ONE HUGE FILE. Most CDs split the parts book into chapters (sp/03.pdf ..).
   A few (the DI650 82517) ship it as one PDF - 1,958 pages, 285 MB - which a
   phone cannot open: it has to be downloaded whole and held in memory.
   Such a file is cut into chapters along its own bookmarks, and a chapter
   longer than `maxPages` is cut again at its sub-assembly bookmarks, so a
   tech downloads the part of the book he is in.

   This is the plan only - which pages go in which piece - so it can be
   tested without a 285 MB file. `chapters` is [{title, page, kids:[{page}]}]. */
export const BIG = 60 * 1048576;
export function chunksFor(chapters, numPages, maxPages) {
  const max = maxPages || 160;
  const out = [];
  const cs = (chapters || []).filter(c => c.page >= 1 && c.page <= numPages)
    .sort((a, b) => a.page - b.page);
  if (!cs.length) {
    for (let s = 1, n = 1; s <= numPages; s += max, n++) {
      out.push({ key: String(n).padStart(2, '0'), title: 'Pages ' + s + '–' + Math.min(numPages, s + max - 1),
                 from: s, to: Math.min(numPages, s + max - 1) });
    }
    return out;
  }
  if (cs[0].page > 1) out.push({ key: '00', title: 'Cover and contents', from: 1, to: cs[0].page - 1 });
  cs.forEach((c, i) => {
    const end = i + 1 < cs.length ? cs[i + 1].page - 1 : numPages;
    const m = String(c.title || '').match(/^(\d+)\s+(.*)$/);
    const key = m ? m[1].padStart(2, '0') : String(i + 1).padStart(2, '0');
    const name = m ? m[2] : String(c.title || 'Chapter ' + (i + 1));
    if (end < c.page) return;
    const cuts = (c.kids || []).map(k => k.page).filter(p => p > c.page && p <= end)
      .sort((a, b) => a - b).filter((p, j, a) => j === 0 || p !== a[j - 1]);
    if (end - c.page + 1 <= max || !cuts.length) {
      out.push({ key, title: name, from: c.page, to: end });
      return;
    }
    const pieces = [];
    let start = c.page, prev = null;
    for (const p of cuts) {
      if (p - start > max) {
        const at = prev && prev > start ? prev : p;
        pieces.push([start, at - 1]);
        start = at;
      }
      prev = p;
    }
    pieces.push([start, end]);
    pieces.forEach(([a, b], j) => out.push({
      key: key + '-' + (j + 1), title: name + ' — part ' + (j + 1) + ' of ' + pieces.length
        + ' (pages ' + (a - c.page + 1) + '–' + (b - c.page + 1) + ')', from: a, to: b }));
  });
  return out;
}

/* "ROCK DRILL" -> "Rock Drill". The CDs shout; the app does not. Short joining
   words stay small, and anything with a digit (DX800, 3/2) is left alone. */
export function niceTitle(s) {
  const small = new Set(['and', 'or', 'of', 'the', 'for', 'to', 'in', 'on', 'with', 'a']);
  const keep = new Set(['USA', 'US', 'EU', 'CE', 'ECU', 'PLC', 'LED', 'GPS', 'CAT', 'AC', 'DC', 'HVAC',
                        'UK', 'SMC', 'TIM', 'RCS', 'CAN', 'ROPS', 'FOPS']);
  return String(s || '').trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
    if (/\d/.test(w) || keep.has(w)) return w;
    const l = w.toLowerCase();
    if (i > 0 && small.has(l)) return l;
    return l.replace(/(^|[-/(&])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}

/* Files the CD gives no name inside, by what their file names mean on every
   Toolman CD. Anything not here keeps its own (tidied) file name. */
const KNOWN = {
  conws: 'Workshop Manual — Contents', conma: 'Maintenance Manual — Contents',
  conop: 'Operator’s Manual — Contents', consp: 'Parts Manual — Contents', content: 'Contents',
  contents: 'Contents', rockdrill: 'Rock Drill', dust: 'Dust Collector', rod: 'Rod Handling',
  safetyinstructions: 'Safety Instructions', home: 'CD Home Page', info: 'About This CD', help: 'CD Help',
  maintenance_manual: 'Maintenance Manual', operators_manual: 'Operator’s Manual',
  warrant_eng_ger: 'Warranty (English / German)', dxped_vakuutus_en: 'Pressure Equipment Declaration',
  start: 'Rock Tools', cathome: 'Cat Engine Manuals',
};
export function fileTitle(name) {
  const base = String(name || '').replace(/\.pdf$/i, '');
  const k = base.toLowerCase();
  if (KNOWN[k]) return KNOWN[k];
  let m = base.match(/^OM\s+(SEBU[\w-]+)/i);
  if (m) return 'Operation & Maintenance Manual ' + m[1].replace(/-ALL$/i, '');
  m = base.match(/^PM\s+(SEBP[\w-]+)/i);
  if (m) return 'Parts Manual ' + m[1].replace(/-ALL$/i, '');
  m = base.match(/^CE\s+Englanti/i);
  if (m) return 'CE Declaration (English)';
  return niceTitle(base.replace(/_/g, ' '));
}

/* What the CD calls a spare-parts chapter: its own first bookmark, which is
   also the heading on its first page - FEED, BOOM, CARRIER, POWERPACK.
   Read with MuPDF (one of the CD's PDFs is damaged enough to crash pdf.js),
   and remembered in `cache` by path, size and date. */
async function cdTitle(file, cache) {
  const st = fs.statSync(file);
  const k = file + '|' + st.size + '|' + Math.round(st.mtimeMs);
  if (cache[k] !== undefined) return cache[k];
  let t = '';
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf');
    const ol = doc.loadOutline() || [];
    t = String((ol[0] && ol[0].title) || '').trim();
    if (!t && doc.countPages()) {
      t = doc.loadPage(0).toStructuredText().asText().split('\n').map(x => x.trim()).find(Boolean) || '';
    }
    /* a "go back" link is not a name - the next bookmark is */
    if (/^(back|return) to /i.test(t) && ol[1]) t = String(ol[1].title || '').trim();
  } catch (e) { t = ''; }
  cache[k] = t.slice(0, 80);
  return cache[k];
}

/* Cut one big PDF into the planned pieces, into `outDir`. Remembered by the
   source's size and date (`side`), so it is done once, not on every run. */
async function splitPdf(src, outDir, side, maxPages, prefix, say) {
  const st = fs.statSync(src);
  try {
    const s = JSON.parse(fs.readFileSync(side, 'utf8'));
    if (s.size === st.size && s.mtime === Math.round(st.mtimeMs)
        && s.chunks.every(c => fs.existsSync(path.join(outDir, c.file)))) return s.chunks;
  } catch (e) { /* not done yet */ }
  if (say) say();
  /* MuPDF, not a pure-JS library: the CD exports are big and not always
     tidy inside (pdf-lib could not find the 82517 book's page list at all),
     and MuPDF reads what viewers read. Only ever run here, on the workstation. */
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(fs.readFileSync(src), 'application/pdf');
  const whole = doc.asPDF();
  const numPages = doc.countPages();
  /* outline page numbers are counted from 0 */
  const pageOf = it => {
    if (typeof it.page === 'number' && it.page >= 0) return it.page + 1;
    try { return it.uri ? doc.resolveLink(it.uri) + 1 : 0; } catch (e) { return 0; }
  };
  let ol = doc.loadOutline() || [];
  if (ol.length === 1 && ol[0].down && ol[0].down.length) ol = ol[0].down;   /* one wrapper bookmark */
  const chapters = ol
    .filter(it => !/^table of contents$/i.test(String(it.title || '').trim()))
    .map(it => ({ title: String(it.title || '').trim(), page: pageOf(it),
                  kids: (it.down || []).map(k => ({ page: pageOf(k) })) }));
  const plan = chunksFor(chapters, numPages, maxPages);
  fs.mkdirSync(outDir, { recursive: true });
  const chunks = [];
  for (const c of plan) {
    const part = new mupdf.PDFDocument();
    const map = part.newGraftMap();
    for (let p = c.from; p <= c.to; p++) map.graftPage(-1, whole, p - 1);
    /* named after the file it came from, so it can never land on top of a
       real chapter file (03.pdf) on a CD that has both */
    const file = (prefix ? prefix + '-' : '') + c.key + '.pdf';
    fs.writeFileSync(path.join(outDir, file), part.saveToBuffer('compress=yes,garbage=compact').asUint8Array());
    chunks.push({ file, key: c.key, title: c.title, from: c.from, to: c.to });
  }
  fs.writeFileSync(side, JSON.stringify({ size: st.size, mtime: Math.round(st.mtimeMs), chunks }));
  return chunks;
}

/* An Epiroc book page with its drawings folded in. The page asks for
   "fig/p010.webp"; the app shows it in a sealed frame that cannot fetch
   anything relative, so the drawing has to already be in the page. */
export function inlineFigures(html, figDir) {
  if (!fs.existsSync(figDir)) return { html, count: 0 };
  let count = 0;
  const cache = {};
  const out = html.replace(/(["'])fig\/([A-Za-z0-9_.-]+\.(webp|png|jpe?g))\1/g, (m, q, name, ext) => {
    const file = path.join(figDir, name);
    if (!fs.existsSync(file)) return m;
    if (!cache[name]) {
      const type = ext === 'jpg' ? 'jpeg' : ext;
      cache[name] = 'data:image/' + type + ';base64,' + fs.readFileSync(file).toString('base64');
    }
    count++;
    return q + cache[name] + q;
  });
  return { html: out, count };
}

function bucketName() {
  const cfg = fs.readFileSync(path.join(REPO, 'config.js'), 'utf8');
  const m = cfg.match(/storageBucket:\s*'([^']+)'/);
  if (!m) throw new Error('No storageBucket in config.js');
  return m[1];
}

/* Copy only what changed, so a second run is quick. */
function copyIfNewer(src, dst) {
  if (fs.existsSync(dst)) {
    const a = fs.statSync(src), b = fs.statSync(dst);
    if (a.size === b.size && a.mtimeMs <= b.mtimeMs) return false;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

const writeJson = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
};

/* ---------- the run ------------------------------------------------------ */

export async function run(argv, opts) {
  const o = opts || {};
  const log = o.log || console.log;
  const booksDir = o.booksDir || BOOKS;
  const repo = o.repo || REPO;
  const stage = path.join(booksDir, 'staging');
  const data = JSON.parse(fs.readFileSync(path.join(repo, 'books.data.json'), 'utf8'));
  const libs = o.libraries || data.libraries;

  const adds = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--add') adds.push(argv[++i]);

  /* What is wanted: every serial match, plus whatever was asked for. */
  const wanted = new Map();
  data.machines.filter(m => m.state === 'matched' && m.book).forEach(m => {
    wanted.set(m.book.folder, { ...m.book });
  });
  adds.forEach(folder => {
    const row = data.library.find(r => r.folder === folder);
    if (!row) throw new Error('Not in the library index: ' + folder
      + '\nUse the folder name exactly as the app shows it.');
    wanted.set(folder, { lib: row.lib, folder: row.folder, serial: row.serial });
  });

  /* Keep anything already up there from an earlier --add, so adding one book
     does not quietly drop the last one from the app's list. */
  const prevFile = path.join(repo, 'books.stored.json');
  const prev = fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')) : { books: [] };
  prev.books.filter(b => b.kind === 'pdf' && !wanted.has(b.folder)).forEach(b => {
    wanted.set(b.folder, { lib: b.lib, folder: b.folder, serial: b.serial });
  });

  const stored = [];
  let copied = 0;

  /* Plan every book first, so files shared between books can be found. */
  const plans = [];
  for (const b of wanted.values()) {
    const src = path.join(libs[b.lib] || '', b.folder);
    if (!fs.existsSync(src)) { log('MISSING  ' + src + ' (skipped)'); continue; }
    const id = 'tm-' + slug(b.folder);
    plans.push({ id, b, plan: planToolman(src, { id, title: b.folder, lib: b.lib, folder: b.folder, serial: b.serial }) });
  }

  /* A parts book that came as one huge file is cut into chapters first; the
     pieces then go through everything below like any other file. */
  for (const P of plans) {
    const bigs = P.plan.files.filter(f => /^sp\//i.test(f.rel) && f.size > (o.big || BIG));
    for (const big of bigs) {
      const outDir = path.join(stage, P.id, 'files', 'sp');
      const side = path.join(stage, '.split-' + P.id + '-' + slug(big.rel) + '.json');
      const chunks = await splitPdf(big.full, outDir, side, o.maxPages,
        slug(path.basename(big.rel, path.extname(big.rel))),
        () => log(`${P.id}: ${big.rel} is ${(big.size / 1048576).toFixed(0)} MB in one file - cutting it into chapters…`));
      const sp = P.plan.manifest.sections.find(s => s.key === 'sp');
      sp.files = sp.files.filter(x => x.p !== big.rel);
      P.plan.files = P.plan.files.filter(x => x !== big);
      chunks.forEach(c => {
        const full = path.join(outDir, c.file);
        const size = fs.statSync(full).size;
        const rel = 'sp/' + c.file;
        P.plan.files.push({ full, rel, size });
        const n = c.key.split('-')[0].replace(/^0(?=\d)/, '');
        const [name, rest] = String(c.title).split(/ — (.*)/s);
        /* `ch` lets a part search point at the piece a part is printed in */
        sp.files.push({ p: rel, t: (c.key === '00' ? '' : n + '. ') + niceTitle(name) + (rest ? ' — ' + rest : ''),
                        b: size, pages: [c.from, c.to], ch: c.key });
      });
      sp.files.sort((a, b) => a.p.localeCompare(b.p, 'en', { numeric: true }));
      const biggest = Math.max(...chunks.map(c => fs.statSync(path.join(outDir, c.file)).size));
      log(`${P.id}: ${big.rel} is kept as ${chunks.length} pieces, the largest ${(biggest / 1048576).toFixed(0)} MB.`);
    }
  }

  /* A PART INDEX FOR A CD THAT HAS NONE. Most CDs ship Indexlist/*.txt; a
     few do not (the DI650 82517, the DX800 S5 68792). For those, the index
     is read off the printed parts lists themselves (tools/text_index.mjs) -
     checked against a CD that does have one, it finds 4,138 of its 4,139.
     Remembered per file by path, size and date, so it is read once. */
  const tiFile = path.join(stage, '.textindex.json');
  let ti = {};
  try { ti = JSON.parse(fs.readFileSync(tiFile, 'utf8')); } catch (e) { ti = {}; }
  for (const P of plans) {
    if (P.plan.index || o.textIndex === false) continue;
    const sp = P.plan.manifest.sections.find(s => s.key === 'sp');
    if (!sp) continue;
    const full = {};
    P.plan.files.forEach(f => { full[f.rel] = f.full; });
    let rows = [];
    for (const f of sp.files.filter(x => x.ch && full[x.p])) {
      const st = fs.statSync(full[f.p]);
      const k = full[f.p] + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|' + f.ch;
      if (!ti[k]) {
        try {
          const { buildFromPdf } = await import('./text_index.mjs');
          ti[k] = await buildFromPdf(full[f.p], f.ch);
        } catch (e) { ti[k] = []; }                 /* a damaged chapter just has no rows */
      }
      rows = rows.concat(ti[k]);
    }
    if (rows.length) {
      P.plan.index = { v: 1, source: 'printed parts lists',
        cols: ['part', 'desc', 'chapter', 'asmNo', 'asm', 'qty', 'pos', 'page'], rows };
      P.plan.manifest.parts = rows.length;
      log(`${P.id}: no index on the CD - ${rows.length} parts read off its printed lists.`);
    }
  }
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(tiFile, JSON.stringify(ti));

  /* NAMED LIKE THE CD. A spare-parts chapter is listed by the name the CD
     gives it - "11. Carrier", "7. Feed" - not by its file number or a guess
     from the assemblies in it. The assembly guess is only the fallback for
     a chapter the CD does not name. */
  const titleFile = path.join(stage, '.titles.json');
  let tc = {};
  try { tc = JSON.parse(fs.readFileSync(titleFile, 'utf8')); } catch (e) { tc = {}; }
  for (const P of plans) {
    const full = {};
    P.plan.files.forEach(f => { full[f.rel] = f.full; });
    /* every file, not just the parts chapters: "maintenance_manual" and
       "conws" are what the CD calls its files, not what it calls the books */
    for (const s of P.plan.manifest.sections) {
      for (const f of s.files) {
        if (f.pages) continue;                     /* a piece of a cut book is already named */
        const raw = full[f.p] ? await cdTitle(full[f.p], tc) : '';
        /* some CDs left junk in the bookmark - "Untitled", "Local Disk", a
           file name, a web address. Those are not names. */
        const junk = !raw || /^\d+$/.test(raw) || /^(untitled|local disk|document\d*|page \d+)$/i.test(raw)
          || /\.(pdf|docx?|com|net|org)$/i.test(raw);
        const cd = junk ? '' : niceTitle(raw);
        if (cd) {
          f.t = (s.key === 'sp' && f.ch ? String(Number(f.ch)) + '. ' : '') + cd;
        } else if (!(s.key === 'sp' && f.ch)) {
          f.t = fileTitle(path.basename(f.p));
        }
      }
    }
    const sp = P.plan.manifest.sections.find(s => s.key === 'sp');
    if (!sp) continue;
    /* the numbered chapters first, in the CD's order; its contents pages,
       identification card and linked diagrams after them */
    const numbered = f => !!(f.ch || f.pages);
    sp.files.sort((a, b) => (numbered(b) - numbered(a)) || a.p.localeCompare(b.p, 'en', { numeric: true }));
  }
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(titleFile, JSON.stringify(tc));

  /* STORED ONCE. The CDs repeat themselves - the same Cat engine manual,
     warranty and CD help on most of them. Each file is fingerprinted by its
     content; the first book (by id, so the choice is stable from run to run)
     keeps the copy, and every other book's manifest points at that one. A
     phone then also downloads a shared manual once, not once per rig.
     Fingerprints are remembered by path, size and date, so a re-run does not
     re-read 5 GB. */
  const hashFile = path.join(stage, '.hashes.json');
  let hc = {};
  try { hc = JSON.parse(fs.readFileSync(hashFile, 'utf8')); } catch (e) { hc = {}; }
  const hashOf = f => {
    const st = fs.statSync(f.full);
    const k = f.full + '|' + st.size + '|' + Math.round(st.mtimeMs);
    if (!hc[k]) hc[k] = crypto.createHash('sha1').update(fs.readFileSync(f.full)).digest('hex');
    return hc[k];
  };
  plans.forEach(P => P.plan.files.forEach(f => { f.hash = hashOf(f); }));
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(hashFile, JSON.stringify(hc));
  const owner = new Map();
  [...plans].sort((a, b) => a.id.localeCompare(b.id)).forEach(P =>
    P.plan.files.forEach(f => { if (!owner.has(f.hash)) owner.set(f.hash, P.id + '/files/' + f.rel); }));

  let sharedFiles = 0, sharedBytes = 0;
  for (const P of plans) {
    const { id, b, plan } = P;
    const out = path.join(stage, id);
    const keep = new Set();
    const entry = {};
    plan.manifest.sections.forEach(s => s.files.forEach(x => { entry[x.p] = x; }));
    let own = 0;
    plan.files.forEach(f => {
      const home = owner.get(f.hash);
      if (home === id + '/files/' + f.rel) {
        keep.add(f.rel);
        own += f.size;
        if (copyIfNewer(f.full, path.join(out, 'files', ...f.rel.split('/')))) copied++;
      } else {
        entry[f.rel].o = home;          /* read it from the book that holds it */
        sharedFiles++;
        sharedBytes += f.size;
      }
    });
    /* a copy staged by an earlier run that is now held elsewhere goes */
    const filesDir = path.join(out, 'files');
    if (fs.existsSync(filesDir)) {
      walk(filesDir, '', []).forEach(x => { if (!keep.has(x.rel)) fs.unlinkSync(x.full); });
    }
    writeJson(path.join(out, 'manifest.json'), plan.manifest);
    if (plan.index) writeJson(path.join(out, 'index.json'), plan.index);
    const mb = plan.files.reduce((s, f) => s + f.size, 0) / 1048576;
    stored.push({ id, kind: 'pdf', title: b.folder, lib: b.lib, folder: b.folder,
                  serial: b.serial || '', files: plan.files.length, mb: Math.round(mb),
                  parts: plan.manifest.parts });
    log(`${id.padEnd(34)} ${String(plan.files.length).padStart(3)} PDFs  ${mb.toFixed(0).padStart(4)} MB  `
      + `${(own / 1048576).toFixed(0).padStart(4)} MB its own  ${plan.manifest.parts} parts indexed`);
  }
  if (plans.length) {
    log(`Shared: ${sharedFiles} files (${(sharedBytes / 1073741824).toFixed(2)} GB) are kept once and pointed to.`);
  }

  /* Single pages built by hand earlier, one folder each: the Epiroc parts
     books (<books>/epiroc) and the reference shelf of schematics and manuals
     (<books>/shelves). Titles - and for books, serials - come from config.js,
     which already lists them. A shelf page carries no serial on purpose: it
     is not any one machine's book and must never match one. */
  const cfg = fs.readFileSync(path.join(repo, 'config.js'), 'utf8');
  const PAGES = [
    { dir: 'epiroc', prefix: 'epiroc-', lib: 'Epiroc', shelf: false },
    { dir: 'shelves', prefix: 'shelf-', lib: 'Reference', shelf: true },
  ];
  for (const P of PAGES) {
    const dir = path.join(booksDir, P.dir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const page = path.join(dir, name, 'index.html');
      if (!fs.existsSync(page)) continue;
      const m = cfg.match(new RegExp("\\{ id: '" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        + "',\\s*title: '([^']*)'(?:,\\s*serial: '([^']*)')?"));
      const serial = P.shelf ? '' : (m && m[2]) || '';
      const id = P.prefix + slug(name);
      const { html, count } = inlineFigures(fs.readFileSync(page, 'utf8'), path.join(dir, name, 'fig'));
      const out = path.join(stage, id);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'book.html'), html);
      const title = m ? m[1] : name;
      writeJson(path.join(out, 'manifest.json'), {
        v: 1, kind: 'html', id, title, lib: P.lib, folder: name, serial,
        shelf: P.shelf || undefined, file: 'book.html', builtAt: new Date().toISOString().slice(0, 10) });
      const mb = Buffer.byteLength(html) / 1048576;
      stored.push({ id, kind: 'html', title, lib: P.lib, folder: name, ref: name, serial,
                    shelf: P.shelf || undefined, files: 1, mb: Math.round(mb * 10) / 10 });
      log(`${id.padEnd(34)}   1 page  ${mb.toFixed(1).padStart(5)} MB  `
        + (P.shelf ? 'reference' : count + ' drawings folded in'));
    }
  }

  stored.sort((a, b) => a.id.localeCompare(b.id));
  const total = walk(stage, '', []).filter(x => !x.rel.startsWith('.')).reduce((s, x) => s + x.size, 0) / 1048576;
  fs.writeFileSync(prevFile, JSON.stringify(
    { builtAt: new Date().toISOString().slice(0, 10), books: stored }, null, 1) + '\n');
  log(`\n${stored.length} books, about ${(total / 1024).toFixed(2)} GB. ${copied} files copied this run.`);
  log('Staging: ' + stage);
  log('Wrote:   ' + prevFile);
  return { stage, stored };
}

function upload(stage) {
  const bucket = bucketName();
  const dest = 'gs://' + bucket + '/books';
  console.log('\nUploading to ' + dest + ' - safe to stop and run again, it resumes.\n');
  /* The bucket is made to MATCH the staging folder: a copy that is now kept
     in another book (or a book taken down) is deleted from it. Everything
     under books/ comes from here, so nothing else is in the way. The
     fingerprint cache stays on this machine. */
  const r = spawnSync('gcloud', ['storage', 'rsync', '"' + stage + '"', dest, '--recursive',
    '--delete-unmatched-destination-objects', '--exclude', '"^\\."'],
    { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('\nThe upload stopped (exit ' + r.status + '). Run the same command again to carry on.');
    process.exit(r.status || 1);
  }
  console.log('\nUp. Now commit books.stored.json and push the app, or the app will not know.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const { stage } = await run(args);
  if (args.includes('--upload')) upload(stage);
}
