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
import { fileURLToPath } from 'url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOOKS = process.env.BSDS_BOOKS_DIR || 'C:\\Users\\cluna\\Downloads\\bsds-books';

/* ---------- small helpers, exported for the test ------------------------ */

export const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* What each Toolman folder is, in the words a tech would use. Order is the
   order they are listed in the app: parts first, because that is why anyone
   opens a parts book. */
export const SECTIONS = [
  ['sp', 'Spare parts'],
  ['ws', 'Workshop'],
  ['ma', 'Maintenance'],
  ['op', 'Operator'],
  ['cat', 'Engine (Cat)'],
  ['rocktools', 'Rock tools'],
  ['info', 'Safety, warranty and info'],
  ['', 'Other'],
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

  const sections = SECTIONS.map(([key, title]) => ({ key, title, files: [] }));
  const other = sections.find(s => s.key === '');
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

export function run(argv, opts) {
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

  for (const b of wanted.values()) {
    const src = path.join(libs[b.lib] || '', b.folder);
    if (!fs.existsSync(src)) { log('MISSING  ' + src + ' (skipped)'); continue; }
    const id = 'tm-' + slug(b.folder);
    const plan = planToolman(src, { id, title: b.folder, lib: b.lib, folder: b.folder, serial: b.serial });
    const out = path.join(stage, id);
    plan.files.forEach(f => { if (copyIfNewer(f.full, path.join(out, 'files', ...f.rel.split('/')))) copied++; });
    writeJson(path.join(out, 'manifest.json'), plan.manifest);
    if (plan.index) writeJson(path.join(out, 'index.json'), plan.index);
    const mb = plan.files.reduce((s, f) => s + f.size, 0) / 1048576;
    stored.push({ id, kind: 'pdf', title: b.folder, lib: b.lib, folder: b.folder,
                  serial: b.serial || '', files: plan.files.length, mb: Math.round(mb),
                  parts: plan.manifest.parts });
    log(`${id.padEnd(34)} ${String(plan.files.length).padStart(3)} PDFs  ${mb.toFixed(0).padStart(4)} MB  `
      + `${plan.manifest.parts} parts indexed`);
  }

  /* Epiroc: one page each, from the folder they were downloaded into. The
     titles and serials come from config.js, which already lists them. */
  const epDir = path.join(booksDir, 'epiroc');
  if (fs.existsSync(epDir)) {
    const cfg = fs.readFileSync(path.join(repo, 'config.js'), 'utf8');
    for (const name of fs.readdirSync(epDir)) {
      const page = path.join(epDir, name, 'index.html');
      if (!fs.existsSync(page)) continue;
      const m = cfg.match(new RegExp("\\{ id: '" + name + "',\\s*title: '([^']*)',\\s*serial: '([^']*)'"));
      const id = 'epiroc-' + slug(name);
      const { html, count } = inlineFigures(fs.readFileSync(page, 'utf8'), path.join(epDir, name, 'fig'));
      const out = path.join(stage, id);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'book.html'), html);
      const title = m ? m[1] : name;
      writeJson(path.join(out, 'manifest.json'), {
        v: 1, kind: 'html', id, title, lib: 'Epiroc', folder: name, serial: m ? m[2] : '',
        file: 'book.html', builtAt: new Date().toISOString().slice(0, 10) });
      const mb = Buffer.byteLength(html) / 1048576;
      stored.push({ id, kind: 'html', title, lib: 'Epiroc', folder: name, ref: name,
                    serial: m ? m[2] : '', files: 1, mb: Math.round(mb * 10) / 10 });
      log(`${id.padEnd(34)}   1 page  ${mb.toFixed(1).padStart(5)} MB  ${count} drawings folded in`);
    }
  }

  stored.sort((a, b) => a.id.localeCompare(b.id));
  const total = stored.reduce((s, b) => s + b.mb, 0);
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
  const r = spawnSync('gcloud', ['storage', 'rsync', stage, dest, '--recursive'],
    { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('\nThe upload stopped (exit ' + r.status + '). Run the same command again to carry on.');
    process.exit(r.status || 1);
  }
  console.log('\nUp. Now commit books.stored.json and push the app, or the app will not know.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const { stage } = run(args);
  if (args.includes('--upload')) upload(stage);
}
