/* The script that puts books into storage.
 *
 * It runs against a small fake Toolman library built in a temp folder, so it
 * needs no D: drive, no bucket and no browser. What it checks is what would
 * hurt if it went wrong: a program or the CD plumbing going up, a book for
 * the wrong serial going up, a drawing missing from a converted page, and the
 * part index pointing at the wrong chapter.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { run, parseIndex, chapterTitles, slug, inlineFigures, chunksFor } from '../tools/stage_books.mjs';

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

/* a real, tiny PDF: one line of text per page */
function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  const font = 3 + pages.length * 2;
  pages.forEach(txt => {
    const c = `BT /F1 18 Tf 72 700 Td (${txt}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + at.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return out;
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bsds-stage-'));
const put = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };

/* ---- the index parser, on the real line shapes ------------------------ */
const IDX = [
  '@00021768a@53@LUMINOUS BADGE@11@BG00334706d@Signs And Decals Assembly@@',
  '@00302748@4@Pin@16@05502008f@Towing eye@1@',
  '@00590818@5@Pin, Locking@16@05502008f@Towing eye@1@',
  '@02814520b@61@Decal@11@BG00334706d@Signs And Decals Assembly@1@',
  '@02814520b@61@Decal@11@BG00334706d@Signs And Decals Assembly@1@',
  '@03246358@*49@Clip@13@55190585e@Tank Assembly@1@',
  'garbage line',
].join('\r\n');
const rows = parseIndex(IDX);
ok(rows.length === 5, 'the index keeps one of each line and drops junk', String(rows.length));
ok(rows[1][0] === '00302748' && rows[1][2] === '16' && rows[1][4] === 'Towing eye',
  'a line reads as part, chapter and assembly', JSON.stringify(rows[1]));
const ch = chapterTitles(rows);
ok(/Towing eye/.test(ch['16']) && /Tank Assembly/.test(ch['13']),
  'chapters are named after what is in them', JSON.stringify(ch));
const old = parseIndex('00021768\t53\tLUMINOUS BADGE\t11-94\t55090941e\tSIGN AND DECAL ASSEMBLY\t4,4\t\r\n'
  + '03246358\t*49\tClip\t12-78\t55025976b\tAIR RECEIVER ASSEMBLY\t1\t');
ok(old.length === 2 && old[0][2] === '11' && old[0][7] === '94' && old[1][4] === 'AIR RECEIVER ASSEMBLY',
  'the older tab-separated index reads too, page and all', JSON.stringify(old[0]));
ok(rows[1][7] === '', 'the @ format has no page and says so');
ok(slug('Ranger DX800 T4 47047') === 'ranger-dx800-t4-47047', 'slugs are plain', slug('Ranger DX800 T4 47047'));

/* ---- a fake library ---------------------------------------------------- */
const LIB = path.join(T, 'lib');
/* matched book, laid out one level down in a serial folder */
const A = path.join(LIB, 'Ranger DX800 T4 47047', '47047');
put(path.join(A, 'home.pdf'), 'pdf');
put(path.join(A, 'sp', '16.pdf'), 'pdf16');
put(path.join(A, 'sp', '13.pdf'), 'pdf13');
put(path.join(A, 'sp', 'CONTENT.pdf'), 'c');
put(path.join(A, 'ws', 'hydraulics.pdf'), 'h');
put(path.join(A, 'info', 'warranty.PDF'), 'w');
put(path.join(A, 'fscommand', 'readme.pdf'), 'plumbing');
put(path.join(A, 'fscommand', 'setup.exe'), 'MZ');
put(path.join(A, 'startup.exe'), 'MZ');
put(path.join(A, 'Indexlist', '47047.txt'), IDX);
put(path.join(LIB, 'Ranger DX800 T4 47047', 'autorun.bat'), 'x');
/* matched book laid out at the top, no index */
const B = path.join(LIB, 'Leopard DI650 82517');
put(path.join(B, 'sp', '03.pdf'), 'p');
put(path.join(B, 'op', 'operators_manual.pdf'), 'o');
/* the same engine manual on both CDs - byte for byte */
put(path.join(A, 'cat', 'PM engine.pdf'), 'SAME ENGINE MANUAL');
put(path.join(B, 'cat', 'PM engine.pdf'), 'SAME ENGINE MANUAL');
/* the near miss: in the library, NOT matched - must not go up */
put(path.join(LIB, 'Leopard DI550 S5 60673', 'sp', '03.pdf'), 'nearmiss');
/* asked for by name */
put(path.join(LIB, 'Pantera DP1500i T4 39376', 'sp', '05.pdf'), 'add');

const REPO = path.join(T, 'repo');
put(path.join(REPO, 'config.js'), [
  "export const CONFIG = { firebase: { storageBucket: 'bsds-app.firebasestorage.app' },",
  "  books: [",
  "    { id: '70165', title: 'DM45-HP 70165',   serial: '70165', url: 'x' },",
  "    { id: 'd65',   title: 'D65',             serial: '',      url: 'y' },",
  "  ],",
  "  shelves: [",
  "    { id: 'which-manual', title: 'Which Manual Does This Drill Take', url: 'z' },",
  "  ] };"].join('\n'));
put(path.join(REPO, 'books.data.json'), JSON.stringify({
  libraries: { Ranger: LIB, Leopard: LIB, Pantera: LIB },
  library: [
    { lib: 'Ranger', folder: 'Ranger DX800 T4 47047', serial: '47047' },
    { lib: 'Leopard', folder: 'Leopard DI650 82517', serial: '82517' },
    { lib: 'Leopard', folder: 'Leopard DI550 S5 60673', serial: '60673' },
    { lib: 'Pantera', folder: 'Pantera DP1500i T4 39376', serial: '39376' },
  ],
  machines: [
    { id: 'a', serial: '47047', state: 'matched', book: { lib: 'Ranger', folder: 'Ranger DX800 T4 47047', serial: '47047' } },
    { id: 'b', serial: '82517', state: 'matched', book: { lib: 'Leopard', folder: 'Leopard DI650 82517', serial: '82517' } },
    { id: 'c', serial: '60674', state: 'hold' },
  ],
}));

/* Epiroc: one with drawings beside it, one self-contained */
const BOOKS = path.join(T, 'books');
put(path.join(BOOKS, 'epiroc', '70165', 'index.html'),
  '<script>var D={"f":[["fig/p010.webp",1,1],["fig/p012.webp",1,1],["fig/p010.webp",1,1]]};</script>'
  + '<img src="fig/p012.webp"><img src="fig/missing.webp">');
put(path.join(BOOKS, 'epiroc', '70165', 'fig', 'p010.webp'), 'RIFF10');
put(path.join(BOOKS, 'epiroc', '70165', 'fig', 'p012.webp'), 'RIFF12');
put(path.join(BOOKS, 'epiroc', 'd65', 'index.html'), '<p>self contained</p>');
/* a manual off the reference shelf */
put(path.join(BOOKS, 'shelves', 'which-manual', 'index.html'), '<p>which manual</p>');

const lines = [];
const out = await run([], { booksDir: BOOKS, repo: REPO, log: s => lines.push(s) });
const S = out.stage;
const has = p => fs.existsSync(path.join(S, ...p.split('/')));

/* ---- what went up ------------------------------------------------------ */
ok(has('tm-ranger-dx800-t4-47047/files/sp/16.pdf'), 'a matched book’s parts chapters are staged');
ok(has('tm-ranger-dx800-t4-47047/files/home.pdf'), 'its home page is staged');
ok(has('tm-ranger-dx800-t4-47047/files/info/warranty.PDF'), 'a capitalised .PDF is still a PDF');
ok(!has('tm-ranger-dx800-t4-47047/files/fscommand/readme.pdf'), 'the CD plumbing does not go up');
ok(!has('tm-ranger-dx800-t4-47047/files/startup.exe') && !has('tm-ranger-dx800-t4-47047/files/fscommand/setup.exe'),
  'NO PROGRAMS go into the bucket');
ok(has('tm-leopard-di650-82517/files/sp/03.pdf'), 'a book laid out at the top is found too');
ok(!fs.readdirSync(S).some(n => /60673/.test(n)),
  'THE RULE: the near-miss book is not put up just because it is in the library');
ok(!fs.readdirSync(S).some(n => /39376/.test(n)), 'nor is a book nobody asked for');

const man = JSON.parse(fs.readFileSync(path.join(S, 'tm-ranger-dx800-t4-47047', 'manifest.json'), 'utf8'));
ok(man.sections[0].key === 'sp', 'spare parts is listed first', man.sections[0].key);
const ch16 = man.sections[0].files.find(f => f.p === 'sp/16.pdf');
ok(ch16 && /Chapter 16/.test(ch16.t) && /Towing eye/.test(ch16.t) && ch16.ch === '16',
  'a chapter is named for what is in it', ch16 && ch16.t);
ok(man.parts === 5 && has('tm-ranger-dx800-t4-47047/index.json'), 'the part index goes up with it');
ok(!has('tm-leopard-di650-82517/index.json'), 'a book with no index gets none, not an empty one');

/* ---- shared files are kept once ---------------------------------------- */
ok(has('tm-leopard-di650-82517/files/cat/PM engine.pdf'), 'a shared manual is kept in one book');
ok(!has('tm-ranger-dx800-t4-47047/files/cat/PM engine.pdf'), 'THE POINT: and not copied into the other');
const eng = man.sections.flatMap(s => s.files).find(f => f.p === 'cat/PM engine.pdf');
ok(eng && eng.o === 'tm-leopard-di650-82517/files/cat/PM engine.pdf',
  'the other book points at the one copy', eng && eng.o);
ok(man.sections.flatMap(s => s.files).filter(f => f.o).length === 1, 'and nothing that is not shared is pointed away');
const show = Object.fromEntries(man.sections.map(s => [s.key, s.show]));
ok(show.sp === 'open' && show.cat === 'fold' && show.ws === 'fold' && show.info === 'papers',
  'spare parts open, manuals folded, CD paperwork in the pile', JSON.stringify(show));
ok(man.sections.find(s => s.key === 'info').files.some(f => f.p === 'home.pdf'),
  'the CD home page goes in the paperwork, not in front');

/* a copy left from an earlier run, now held elsewhere, is cleared out */
put(path.join(S, 'tm-ranger-dx800-t4-47047', 'files', 'cat', 'PM engine.pdf'), 'SAME ENGINE MANUAL');
await run([], { booksDir: BOOKS, repo: REPO, log: () => {} });
ok(!has('tm-ranger-dx800-t4-47047/files/cat/PM engine.pdf'), 'a stale duplicate is removed on the next run');
ok(fs.existsSync(path.join(S, '.hashes.json')), 'fingerprints are remembered, so a re-run does not re-read everything');

/* ---- Epiroc ------------------------------------------------------------ */
const page = fs.readFileSync(path.join(S, 'epiroc-70165', 'book.html'), 'utf8');
ok(!/["']fig\/p0(10|12)\.webp/.test(page), 'every drawing that exists is folded into the page');
ok((page.match(/data:image\/webp;base64,/g) || []).length === 4, 'all four references, the repeat included',
  String((page.match(/data:image\/webp;base64,/g) || []).length));
ok(/fig\/missing\.webp/.test(page), 'a drawing that is not on disk is left as it was, not invented');
ok(page.includes(Buffer.from('RIFF12').toString('base64')), 'and it is the right drawing');
ok(has('epiroc-d65/book.html'), 'a self-contained page goes up as it is');

/* ---- the list the app reads ------------------------------------------- */
const stored = JSON.parse(fs.readFileSync(path.join(REPO, 'books.stored.json'), 'utf8'));
const ids = stored.books.map(b => b.id);
ok(ids.includes('tm-ranger-dx800-t4-47047') && ids.includes('epiroc-70165') && ids.includes('epiroc-d65'),
  'books.stored.json lists what went up', ids.join(','));
const e70165 = stored.books.find(b => b.id === 'epiroc-70165');
ok(e70165.serial === '70165' && e70165.ref === '70165' && e70165.title === 'DM45-HP 70165',
  'the Epiroc entry carries its serial from config.js', JSON.stringify(e70165));
ok(stored.books.find(b => b.id === 'epiroc-d65').serial === '', 'and D65 carries none, because it has none');
const shelf = stored.books.find(b => b.id === 'shelf-which-manual');
ok(shelf && shelf.shelf === true && shelf.title === 'Which Manual Does This Drill Take' && shelf.lib === 'Reference',
  'a manual off the shelf goes up, marked as reference', JSON.stringify(shelf));
ok(shelf && shelf.serial === '', 'and carries no serial, so it can never stand in for a machine’s book');
ok(has('shelf-which-manual/book.html'), 'its page is staged');
ok(!JSON.stringify(stored).includes(LIB.replace(/\\/g, '\\\\')), 'no workstation paths leak into the public list');

/* ---- adding one later -------------------------------------------------- */
await run(['--add', 'Pantera DP1500i T4 39376'], { booksDir: BOOKS, repo: REPO, log: () => {} });
const stored2 = JSON.parse(fs.readFileSync(path.join(REPO, 'books.stored.json'), 'utf8'));
ok(stored2.books.some(b => b.id === 'tm-pantera-dp1500i-t4-39376'), '--add puts up a named book');
await run([], { booksDir: BOOKS, repo: REPO, log: () => {} });
const stored3 = JSON.parse(fs.readFileSync(path.join(REPO, 'books.stored.json'), 'utf8'));
ok(stored3.books.some(b => b.id === 'tm-pantera-dp1500i-t4-39376'),
  'and a later run does not quietly drop it from the app');
let threw = '';
try { await run(['--add', 'Leopard DI550 S5 6067'], { booksDir: BOOKS, repo: REPO, log: () => {} }); }
catch (e) { threw = e.message; }
ok(/Not in the library index/.test(threw), 'a misspelt --add is refused, not guessed at', threw);

/* ---- one huge parts file, cut into chapters ---------------------------- */
/* shaped like the DI650 82517: contents, then numbered chapters, CARRIER
   500-odd pages long with sub-assembly bookmarks every 10 pages */
const di = [
  { title: '1 LEOPARD DI650I', page: 21, kids: [] },
  { title: '2 MAINTENANCE KITS', page: 31, kids: [] },
  { title: '9 CARRIER', page: 591, kids: Array.from({ length: 52 }, (_, i) => ({ page: 591 + i * 10 })) },
  { title: '10 TRACK MODULE', page: 1109, kids: [] },
];
const cut = chunksFor(di, 1200, 160);
ok(cut[0].key === '00' && cut[0].from === 1 && cut[0].to === 20, 'the cover and contents are their own piece');
const carrier = cut.filter(c => c.key.startsWith('09-'));
ok(carrier.length >= 4 && carrier.every(c => c.to - c.from + 1 <= 160),
  'THE POINT: a 518-page chapter is cut into pieces a phone can open', JSON.stringify(carrier.map(c => [c.from, c.to])));
ok(carrier.every(c => di[2].kids.some(k => k.page === c.from)),
  'and every cut falls where an assembly starts, never mid-drawing');
let gapless = true;
cut.forEach((c, i) => { if (i && c.from !== cut[i - 1].to + 1) gapless = false; });
ok(gapless && cut[cut.length - 1].to === 1200, 'no page is lost or repeated between the pieces');
ok(cut.find(c => c.key === '10').title === 'TRACK MODULE', 'chapters keep their names');
const flat = chunksFor([], 400, 160);
ok(flat.length === 3 && flat[2].from === 321 && flat[2].to === 400, 'a big file with no bookmarks is cut by pages');

/* the real thing, on a small PDF: cut, staged, listed, the original gone */
{
  const mupdf = await import('mupdf');
  put(path.join(B, 'sp', 'parts.pdf'), makePdf(['page 1', 'page 2', 'page 3', 'page 4', 'page 5']));
  await run([], { booksDir: BOOKS, repo: REPO, log: () => {}, big: 300, maxPages: 2 });
  const di650 = JSON.parse(fs.readFileSync(path.join(S, 'tm-leopard-di650-82517', 'manifest.json'), 'utf8'));
  const spf = di650.sections.find(s => s.key === 'sp').files.map(f => f.p);
  ok(spf.includes('sp/parts-01.pdf') && spf.includes('sp/parts-03.pdf') && !spf.includes('sp/parts.pdf'),
    'the huge file is listed as its pieces, not as itself', spf.join(' '));
  ok(spf.includes('sp/03.pdf'), 'and a real chapter file beside it is untouched');
  ok(!has('tm-leopard-di650-82517/files/sp/parts.pdf'), 'the 285 MB original does not go up');
  const counts = [];
  for (const n of ['01', '02', '03']) {
    const p = mupdf.Document.openDocument(
      fs.readFileSync(path.join(S, 'tm-leopard-di650-82517', 'files', 'sp', 'parts-' + n + '.pdf')), 'application/pdf');
    counts.push(p.countPages());
  }
  ok(counts.join() === '2,2,1', 'each piece holds its own pages and only those', counts.join());
  ok(!fs.readdirSync(S).some(n => /^\.split-/.test(n)) === false, 'the cut is remembered, so it is done once');
}

/* inlineFigures on its own: no fig folder means nothing changes */
ok(inlineFigures('"fig/p1.webp"', path.join(T, 'nope')).count === 0, 'no fig folder, no change');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
