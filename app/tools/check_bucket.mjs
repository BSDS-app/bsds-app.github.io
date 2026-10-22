/* Is every file the app can ask for actually in the bucket?
 *
 *   gcloud storage ls --recursive --long gs://<bucket>/books/** > bucket-list.txt
 *   node tools/check_bucket.mjs bucket-list.txt
 *
 * Reads each stored book's manifest from the staging folder (the same ones
 * that were uploaded) and checks, for every file it lists - including the
 * shared ones it points to in another book (`o`) - that the object exists
 * and is the size the manifest says. Then lists anything in the bucket that
 * no book uses. Read-only: it changes nothing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE = path.join(process.env.BSDS_BOOKS_DIR || 'C:\\Users\\cluna\\Downloads\\bsds-books', 'staging');
const listFile = process.argv[2] || path.join(path.dirname(STAGE), 'bucket-list.txt');

/* "   12345  2026-10-22T22:26:07Z  gs://bucket/books/x/y.pdf" */
const inBucket = new Map();
/* Windows PowerShell's ">" writes UTF-16; read either */
const rawList = fs.readFileSync(listFile);
const listText = rawList[0] === 0xff && rawList[1] === 0xfe ? rawList.toString('utf16le') : rawList.toString('utf8');
listText.replace(/^﻿/, '').split(/\r?\n/).forEach(line => {
  const m = line.match(/^\s*(\d+)\s+\S+\s+gs:\/\/[^/]+\/books\/(.+)$/);
  if (m) inBucket.set(m[2], Number(m[1]));
});

const stored = JSON.parse(fs.readFileSync(path.join(REPO, 'books.stored.json'), 'utf8')).books;
const used = new Set();
let checked = 0;
const problems = [];
const need = (p, size, why) => {
  used.add(p);
  checked++;
  if (!inBucket.has(p)) problems.push(`MISSING  ${p}  (${why})`);
  else if (size != null && inBucket.get(p) !== size) problems.push(`SIZE     ${p}  bucket ${inBucket.get(p)} vs manifest ${size}`);
};

for (const b of stored) {
  need(b.id + '/manifest.json', null, b.title);
  const man = JSON.parse(fs.readFileSync(path.join(STAGE, b.id, 'manifest.json'), 'utf8'));
  if (man.kind === 'html') { need(b.id + '/' + (man.file || 'book.html'), null, b.title); continue; }
  if (man.parts) need(b.id + '/index.json', null, b.title + ' part index');
  man.sections.forEach(s => s.files.forEach(f => {
    need(f.o || (b.id + '/files/' + f.p), f.b, b.title + ' · ' + f.t);
  }));
}
const orphans = [...inBucket.keys()].filter(k => !used.has(k));

console.log(`${stored.length} books, ${checked} files the app can ask for, ${inBucket.size} objects in the bucket.`);
console.log(problems.length ? problems.join('\n') : 'Every file the app can ask for is there, at the right size.');
console.log(orphans.length ? `\nIn the bucket but used by no book (${orphans.length}):\n  ` + orphans.slice(0, 40).join('\n  ')
  : 'Nothing in the bucket is unused.');
process.exit(problems.length ? 1 : 0);
