/* A one-off check against a REAL staged chapter, not part of `npm test`
 * (it needs the 4.9 GB staging folder on this workstation).
 *
 *   node test/real-book.check.mjs [bookId] [chapter] [part]
 *
 * Serves the app in preview mode with the staging folder standing in for
 * the bucket, opens the chapter from a part search, and saves a phone-sized
 * screenshot of what a tech would see.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STAGE = process.env.BSDS_BOOKS_DIR
  ? path.join(process.env.BSDS_BOOKS_DIR, 'staging')
  : 'C:\\Users\\cluna\\Downloads\\bsds-books\\staging';
const [id = 'tm-ranger-dx800-t4-47047', rel = 'sp/16.pdf', part = '00302748'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.pdf': 'application/pdf' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (u.startsWith('/books-demo/books/')) file = path.join(STAGE, ...u.slice('/books-demo/books/'.length).split('/'));
  else file = path.join(ROOT, u);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (/icon-\d+\.png$/.test(file)) { res.writeHead(404); res.end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (path.basename(file) === 'config.js') body = Buffer.from(String(body).replace(/(\n\s*apiKey: )'[^']*'/, "$1''"));
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(BASE);
await page.click('[data-demo="demo-clint"]');
await page.waitForTimeout(500);
const t0 = Date.now();
await page.evaluate(([b, r, p]) => {
  const btn = document.createElement('button');
  btn.dataset.bfile = r; btn.dataset.book = b; btn.dataset.part = p;
  document.body.appendChild(btn); btn.click(); btn.remove();
}, [id, rel, part]);
await page.waitForFunction(() => /Page \d+ of \d+/.test((document.getElementById('pvpos') || {}).textContent || ''),
  null, { timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => {
  const t = (document.getElementById('pvmsg') || {}).textContent || '';
  return (/ is on page /.test(t) && !/still looking/.test(t)) || / not printed /.test(t);
}, null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(800);
console.log('position:', await page.textContent('#pvpos').catch(() => '?'));
console.log('message :', (await page.textContent('#pvmsg').catch(() => '?')).trim());
console.log('seconds :', ((Date.now() - t0) / 1000).toFixed(1));
const shot = path.join(path.dirname(STAGE), 'viewer-check.png');
await page.screenshot({ path: shot, fullPage: false });
console.log('screenshot:', shot);
if (errs.length) console.log('errors:', errs.join(' | '));
await browser.close();
server.close();
