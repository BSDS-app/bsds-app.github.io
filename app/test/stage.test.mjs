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
import { run, parseIndex, chapterTitles, slug, inlineFigures } from '../tools/stage_books.mjs';

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

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
const out = run([], { booksDir: BOOKS, repo: REPO, log: s => lines.push(s) });
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
run(['--add', 'Pantera DP1500i T4 39376'], { booksDir: BOOKS, repo: REPO, log: () => {} });
const stored2 = JSON.parse(fs.readFileSync(path.join(REPO, 'books.stored.json'), 'utf8'));
ok(stored2.books.some(b => b.id === 'tm-pantera-dp1500i-t4-39376'), '--add puts up a named book');
run([], { booksDir: BOOKS, repo: REPO, log: () => {} });
const stored3 = JSON.parse(fs.readFileSync(path.join(REPO, 'books.stored.json'), 'utf8'));
ok(stored3.books.some(b => b.id === 'tm-pantera-dp1500i-t4-39376'),
  'and a later run does not quietly drop it from the app');
let threw = '';
try { run(['--add', 'Leopard DI550 S5 6067'], { booksDir: BOOKS, repo: REPO, log: () => {} }); }
catch (e) { threw = e.message; }
ok(/Not in the library index/.test(threw), 'a misspelt --add is refused, not guessed at', threw);

/* inlineFigures on its own: no fig folder means nothing changes */
ok(inlineFigures('"fig/p1.webp"', path.join(T, 'nope')).count === 0, 'no fig folder, no change');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
