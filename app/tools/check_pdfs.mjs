/* Can the app's page viewer open every PDF in the books?
 *
 *   node tools/check_pdfs.mjs
 *
 * Opens each staged PDF with pdf.js - the same library, same version, the
 * phone uses - and reads its first page. Lists every file that fails. Those
 * are the ones a tech would see "could not show the pages here" for.
 * Read-only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE = path.join(process.env.BSDS_BOOKS_DIR || 'C:\\Users\\cluna\\Downloads\\bsds-books', 'staging');
console.warn = () => {};
const logq = console.log;
console.log = (...a) => { if (!/polyfill|Require stack|node_modules/.test(String(a[0]))) logq(...a); };
const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.js')).default;

const files = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const f = path.join(d, e.name);
  if (e.isDirectory()) walk(f); else if (/\.pdf$/i.test(e.name)) files.push(f);
});
walk(STAGE);

const bad = [];
let i = 0;
for (const f of files) {
  i++;
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), verbosity: 0,
      standardFontDataUrl: path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep }).promise;
    await (await doc.getPage(1)).getTextContent();
    await doc.destroy();
  } catch (e) {
    bad.push(`${path.relative(STAGE, f)}  -  ${e.message || e.name}`);
  }
  if (i % 100 === 0) logq(`  ${i} of ${files.length}…`);
}
logq(`${files.length} PDFs opened with pdf.js; ${bad.length} could not be shown by the app:`);
bad.forEach(b => logq('  ' + b));
