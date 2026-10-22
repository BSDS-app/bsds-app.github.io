/* A part index read off the printed parts lists, for books whose CD has none.
 *
 * Most Toolman CDs ship an index (Indexlist/*.txt) that says which chapter
 * every part is in. Two of ours do not - the DI650 82517 and the DX800 S5
 * 68792 - so their books have no part search. But every parts-list page is
 * a regular table, and its text comes out of the PDF with positions:
 *
 *    Ref. | Part no.     | Description EN       | Standard designation | Qty
 *    66   | 046 001 70   | VALVE, CHECK         | -                    | 1
 *
 * The header row gives the columns; each row under it with something in the
 * Part no. column is a part. A description that wraps onto the next line is
 * joined back on. The assembly number and name are at the top of the page.
 *
 *   node tools/text_index.mjs --compare tm-leopard-di550-t4-34965
 *        builds one for a book that HAS a real index and measures the two
 *        against each other - how much of the real index it finds, and how
 *        much it finds that the real index does not have.
 *   node tools/text_index.mjs --build tm-leopard-di650-82517
 *        writes <staging>/<book>/index.text.json for review. Nothing is
 *        uploaded and the app does not read that file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { key, partKeys } from '../partmatch.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE = path.join(process.env.BSDS_BOOKS_DIR || 'C:\\Users\\cluna\\Downloads\\bsds-books', 'staging');

/* A printed part number: has digits, is not a page or quantity alone. */
export const looksLikePart = s => {
  const t = String(s || '').trim();
  const k = key(t);
  return k.length >= 5 && /\d/.test(k) && /^[A-Z0-9 .\-/]+$/i.test(t);
};

/* One page's text items -> its rows, or [] if it is not a parts list. */
export function rowsOfPage(items, pageNo) {
  const cells = items.filter(it => String(it.str).trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5], s: String(it.str).trim() }));
  const head = cells.find(c => /^part\s*no\.?$/i.test(c.s));
  if (!head) return [];
  const hy = head.y;
  /* Columns by their heading, wherever they sit - the older CDs print
       Ref. | Part no. | Description EN | Standard designation | Qty
     and the 2022 ones
       Ref. | Part No. | QTY | UOM | Item name | Spare part description | Page | kg
     Each column runs from its heading to the next heading. */
  const heads = cells.filter(c => Math.abs(c.y - hy) < 2.5).sort((a, b) => a.x - b.x);
  /* a piece of text belongs to the last heading that starts at or before it
     (with 10 points of slack - numbers are printed a little left of their
     heading on the newer CDs) */
  const SLACK = 10;
  const headOf = x => { let h = -1; heads.forEach((hd, i) => { if (hd.x <= x + SLACK) h = i; }); return h; };
  const col = re => {
    const i = heads.findIndex(h => re.test(h.s));
    return i < 0 ? null : { i, x: heads[i].x };
  };
  const cRef = col(/^ref/i), cPart = col(/^part\s*no/i), cQty = col(/^qty/i);
  const cDesc = col(/^(description|item name)/i), cStd = col(/^(standard|spare part description)/i);
  if (!cDesc || !cPart) return [];
  const xRef = cRef && cRef.x, xPart = cPart.x;
  const inCol = (cs, c) => !c ? '' : cs.filter(x => headOf(x.x) === c.i)
    .sort((a, b) => a.x - b.x).map(x => x.s).join(' ');

  /* assembly: the part-number-like text and the title above the header */
  const above = cells.filter(c => c.y > hy + 2).sort((a, b) => b.y - a.y || a.x - b.x);
  const asmNo = (above.find(c => looksLikePart(c.s.replace(/\s+(NSS|[a-z]{1,2}[A-Z]?)$/g, ''))) || {}).s || '';
  const asmName = (above.find(c => /[A-Z]{3,}/.test(c.s) && !looksLikePart(c.s) && !/^\d+\s*\(\d+\)$/.test(c.s)
    && !/sandvik|epiroc|copyright/i.test(c.s)) || {}).s || '';

  /* lines under the header, top to bottom */
  const lines = {};
  cells.filter(c => c.y < hy - 2).forEach(c => {
    const k = Object.keys(lines).find(y => Math.abs(Number(y) - c.y) < 2.5) || String(c.y);
    (lines[k] = lines[k] || []).push(c);
  });
  const near = (cs, x, tol) => cs.filter(c => x != null && Math.abs(c.x - x) <= tol)
    .sort((a, b) => a.x - b.x).map(c => c.s).join(' ');
  const out = [];
  Object.keys(lines).map(Number).sort((a, b) => b - a).forEach(y => {
    const cs = lines[y];
    if (cs.every(c => /^[.\-]$/.test(c.s))) return;                   /* the ". . . ." spacer lines */
    if (cs.some(c => /sandvik|epiroc|copyright/i.test(c.s))) return;  /* footer */
    const part = inCol(cs, cPart);
    const desc = inCol(cs, cDesc);
    const ref = inCol(cs, cRef), qty = inCol(cs, cQty);
    if (looksLikePart(part)) {
      out.push({ part: part.replace(/\s+NSS$/i, '').trim(), desc, ref, qty,
        asmNo: asmNo.replace(/\s+(NSS)$/i, ''), asm: asmName, page: pageNo, open: true });
    } else if (!part && !ref && !qty && desc && out.length && out[out.length - 1].open) {
      out[out.length - 1].desc += ' ' + desc;                         /* a wrapped description */
    } else if (ref || qty) {
      if (out.length) out[out.length - 1].open = false;               /* a row with no part number */
    }
  });
  return out;
}

export async function buildFromPdf(file, chapterKey) {
  console.warn = () => {};
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.js')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0,
    standardFontDataUrl: path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep }).promise;
  const rows = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items;
    rowsOfPage(items, i).forEach(r => rows.push(
      [r.part, r.desc, chapterKey, r.asmNo, r.asm, r.qty, r.ref, String(r.page)]));
  }
  await doc.destroy();
  return rows;
}

/* every spare-parts file of a staged book, with the chapter key it would carry */
function chaptersOf(id) {
  const man = JSON.parse(fs.readFileSync(path.join(STAGE, id, 'manifest.json'), 'utf8'));
  const sp = man.sections.find(s => s.key === 'sp');
  return (sp ? sp.files : []).filter(f => f.ch || f.pages).map(f => ({
    key: f.ch || path.basename(f.p, '.pdf').replace(/^parts-/, ''),
    file: f.o ? path.join(STAGE, ...f.o.split('/')) : path.join(STAGE, id, 'files', ...f.p.split('/')),
    p: f.p,
  }));
}

async function buildBook(id) {
  let rows = [];
  for (const c of chaptersOf(id)) {
    /* one damaged chapter must not cost the whole book its index */
    let r = [];
    try { r = await buildFromPdf(c.file, c.key); }
    catch (e) { console.error(`  chapter ${c.key} (${c.p}) could not be read: ${e.message || e.name}`); }
    if (!r.length) console.error(`  chapter ${c.key} (${c.p}): no parts-list rows`);
    rows = rows.concat(r);
  }
  return rows;
}

/* only when run directly - stage_books.mjs imports buildFromPdf */
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = direct ? process.argv.slice(2) : [];
if (args[0] === '--compare' && args[1]) {
  const id = args[1];
  const real = JSON.parse(fs.readFileSync(path.join(STAGE, id, 'index.json'), 'utf8')).rows;
  const built = await buildBook(id);
  /* compare by printed number (revision letter off) and chapter */
  const k = r => partKeys(r[0]).slice(-1)[0] + '|' + String(r[2]).padStart(2, '0');
  const R = new Set(real.map(k)), B = new Set(built.map(k));
  const found = [...R].filter(x => B.has(x)).length;
  const extra = [...B].filter(x => !R.has(x));
  const missed = [...R].filter(x => !B.has(x));
  console.log(`${id}: real index ${R.size} part/chapter pairs, read off the pages ${B.size}`);
  console.log(`  found ${found} of the real index (${(100 * found / R.size).toFixed(1)}%)`);
  console.log(`  read ${extra.length} the real index does not list (${(100 * extra.length / B.size).toFixed(1)}% of what was read)`);
  console.log('  missed, e.g.:', missed.slice(0, 10).join('  '));
  console.log('  extra, e.g.: ', extra.slice(0, 10).join('  '));
  const descOk = built.filter(r => r[1]).length;
  console.log(`  rows with a description: ${descOk} of ${built.length}`);
} else if (args[0] === '--build' && args[1]) {
  const id = args[1];
  const rows = await buildBook(id);
  const out = path.join(STAGE, id, 'index.text.json');
  fs.writeFileSync(out, JSON.stringify({ v: 1, source: 'printed parts lists', cols:
    ['part', 'desc', 'chapter', 'asmNo', 'asm', 'qty', 'pos', 'page'], rows }));
  console.log(`${id}: ${rows.length} rows read off the printed lists -> ${out}`);
  console.log('  e.g.', rows.slice(0, 3).map(r => r.join(' | ')).join('\n       '));
} else if (args.length) {
  console.log('usage: node tools/text_index.mjs --compare <book-id> | --build <book-id>');
}
