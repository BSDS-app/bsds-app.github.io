/* Tries EVERY part in every book's index the way the app does: open the
 * chapter the index names, look for the number on its pages. Reports, per
 * book, how many are found and samples of the ones that are not.
 *
 *   node tools/check_parts.mjs                 all books in the staging folder
 *   node tools/check_parts.mjs tm-leopard-di550-t4-34965
 *
 * Run it after anything changes in how parts are matched, or after books are
 * re-staged. It reads the staging folder, not the bucket.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pageKey, onPage, partKeys } from '../partmatch.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE = path.join(process.env.BSDS_BOOKS_DIR || 'C:\\Users\\cluna\\Downloads\\bsds-books', 'staging');
const only = process.argv[2];

/* pdf.js prints font warnings by the hundred; they are not findings */
const warn = console.warn; console.warn = () => {};
const logq = console.log; console.log = (...a) => { if (!/polyfill|Require stack|node_modules/.test(String(a[0]))) logq(...a); };
const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.js')).default;

const cache = new Map();
async function pagesOf(file) {
  if (cache.has(file)) return cache.get(file);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0,
    standardFontDataUrl: path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    pages.push(pageKey((await (await doc.getPage(i)).getTextContent()).items));
  }
  await doc.destroy();
  cache.set(file, pages);
  return pages;
}

const books = fs.readdirSync(STAGE).filter(n => n.startsWith('tm-') && (!only || n === only))
  .filter(n => fs.existsSync(path.join(STAGE, n, 'index.json')));
const total = { parts: 0, found: 0, other: 0, missing: 0, nochap: 0 };
for (const id of books) {
  const man = JSON.parse(fs.readFileSync(path.join(STAGE, id, 'manifest.json'), 'utf8'));
  const idx = JSON.parse(fs.readFileSync(path.join(STAGE, id, 'index.json'), 'utf8'));
  const chap = {};
  man.sections.forEach(s => s.files.forEach(f => {
    if (f.ch) chap[f.ch] = f.o ? path.join(STAGE, ...f.o.split('/')) : path.join(STAGE, id, 'files', ...f.p.split('/'));
  }));
  const seen = new Set();
  const r = { parts: 0, found: 0, other: 0, missing: 0, nochap: 0, samples: [], how: {} };
  for (const row of idx.rows) {
    const part = row[0], ch = String(row[2] || '').padStart(2, '0');
    const k = part + '|' + ch;
    if (seen.has(k)) continue;
    seen.add(k);
    r.parts++;
    if (!chap[ch]) { r.nochap++; if (r.samples.length < 12) r.samples.push(`no chapter ${ch} for ${part}`); continue; }
    const pages = await pagesOf(chap[ch]);
    /* the way the app does it: whole numbers first, loose only if none */
    let hit = pages.findIndex(p => onPage(p, part, true));
    const strict = hit > -1;
    if (!strict) hit = pages.findIndex(p => onPage(p, part));
    if (hit > -1) {
      r.found++;
      const via = (onPage(pages[hit], part) === partKeys(part)[0] ? 'exact' : 'no-rev-letter')
        + (strict ? '' : '+loose');
      r.how[via] = (r.how[via] || 0) + 1;
      if (!strict && r.samples.length < 12) r.samples.push(`loose only: ${part} (${row[1]}) ch ${ch} p${hit + 1}`);
      /* where the index gives a page (older CDs), say if it disagrees */
      continue;
    }
    /* not in its chapter - is it anywhere in the book's parts? */
    let elsewhere = '';
    for (const [c, f] of Object.entries(chap)) {
      if (c === ch) continue;
      if ((await pagesOf(f)).some(p => onPage(p, part))) { elsewhere = c; break; }
    }
    if (elsewhere) r.other++; else r.missing++;
    if (r.samples.length < 12) r.samples.push(`${part} (${row[1]}) ch ${ch}`
      + (elsewhere ? ` -> printed in ch ${elsewhere}` : ' -> not printed anywhere'));
  }
  ['parts', 'found', 'other', 'missing', 'nochap'].forEach(x => { total[x] += r[x]; });
  logq(`${id.padEnd(30)} ${String(r.parts).padStart(5)} parts  found ${String(r.found).padStart(5)} `
    + `(${(100 * r.found / Math.max(1, r.parts)).toFixed(1)}%)  other-chapter ${r.other}  not-printed ${r.missing}`
    + `  no-chapter ${r.nochap}  ${JSON.stringify(r.how)}`);
  r.samples.forEach(s => logq('      ' + s));
  cache.clear();
}
logq(`\nALL: ${total.parts} parts, found in their chapter ${total.found} `
  + `(${(100 * total.found / Math.max(1, total.parts)).toFixed(1)}%), in another chapter ${total.other}, `
  + `not printed ${total.missing}, chapter missing ${total.nochap}`);
console.warn = warn;
