/* A reading of firestore.rules, not a run of it.
 *
 * The real proof is test/rules.test.mjs against the emulator. That needs a
 * download this build environment is not allowed to make, so this stands in
 * the meantime: it pulls each collection's allow statements out of the file
 * and checks the ones that carry Mike's rules say what they must. It will
 * catch a rule deleted, loosened to `staff()`, or never written. It will not
 * catch a subtle logic error - only the emulator does that.
 */
import fs from 'fs';
import { GRANTS, HARD_RULES } from '../roles.js';

const src = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const bad = [];
const ok = (cond, what, extra) => {
  if (cond) pass++;
  else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

/* pull `match /name/{...} { ... }` blocks out of the file */
function block(name) {
  const re = new RegExp('match\\s+/' + name + '/\\{[^}]*\\}\\s*\\{([\\s\\S]*?)\\n    \\}', 'm');
  const m = src.match(re);
  return m ? m[1] : null;
}
function allows(body, verb) {
  if (!body) return [];
  return [...body.matchAll(/allow\s+([a-z,\s]+):\s*if([^;]+);/g)]
    .filter(m => m[1].split(/[,\s]+/).includes(verb))
    .map(m => m[2].replace(/\s+/g, ' ').trim());
}

const COLLECTIONS = ['users', 'customers', 'equipment', 'preops', 'jsas', 'receipts',
                     'partsRequests', 'partsOrders', 'reports', 'hr', 'books'];

ok(/rules_version\s*=\s*'2'/.test(src), 'the rules declare version 2');
ok(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(src),
  'anything not named is closed by default');

COLLECTIONS.forEach(c => ok(block(c) !== null, `there is a rule block for ${c}`));

/* ---- the five rules, read off the file ------------------------------- */
const receiptsRead = allows(block('receipts'), 'read').join(' | ');
ok(receiptsRead.length > 0, 'receipts have a read rule');
ok(!/isTech\(\)|staff\(\)/.test(receiptsRead),
  'no tech can read a receipt', receiptsRead);
ok(/isOwner\(\)/.test(receiptsRead) && /isOffice\(\)/.test(receiptsRead),
  'owners and office can read receipts', receiptsRead);

const hrAll = (block('hr') || '').replace(/\s+/g, ' ');
ok(/allow read, write: if isOwner\(\);/.test(hrAll),
  'personnel is owners only, read and write', hrAll);
ok(!/isOffice|isTech|staff/.test(hrAll), 'nothing else reaches personnel', hrAll);

['preops', 'jsas'].forEach(c => {
  const r = allows(block(c), 'read').join(' | ');
  ok(/isTech\(\) && mine\(resource\.data\)/.test(r),
    `a tech reads only their own in ${c}`, r);
  ok(!/\bstaff\(\)/.test(r), `${c} is not readable by all staff`, r);
  const w = allows(block(c), 'create').join(' | ');
  ok(/mine\(request\.resource\.data\)/.test(w),
    `${c} can only be filed in your own name`, w);
});

/* ---- the pre-op retention rules --------------------------------------
   Deleting a record is the irreversible one, so the things that stop it
   being deleted are checked here as well as in the app. */
const preopCreate = allows(block('preops'), 'create').join(' | ');
ok(/request\.resource\.data\.hold == false/.test(preopCreate),
  'a pre-op cannot be FILED already on hold', preopCreate);
const preopUpdate = allows(block('preops'), 'update').join(' | ');
ok(/isOwner\(\)/.test(preopUpdate), 'an owner can amend a pre-op', preopUpdate);
[['hold', 'the legal hold'], ['uid', 'whose record it is'],
 ['inspDate', 'the inspection date'], ['formVersion', 'which form it was signed on']]
  .forEach(([f, what]) => {
    ok(new RegExp('request\\.resource\\.data\\.' + f
      + ' == resource\\.data\\.' + f).test(preopUpdate),
      `office cannot change ${what}`, preopUpdate);
  });
ok(!/isTech\(\)/.test(preopUpdate), 'no tech amends a filed pre-op', preopUpdate);
ok(/allow delete: if isOwner\(\);/.test((block('preops') || '').replace(/\s+/g, ' ')),
  'only an owner deletes a pre-op by hand');

/* ---- the JSA retention rules -----------------------------------------
   A JSA has no second clock the way a pre-op does, so nothing but a hold
   keeps one open - and office has no business amending a signed JSA. */
const jsaCreate = allows(block('jsas'), 'create').join(' | ');
ok(/request\.resource\.data\.hold == false/.test(jsaCreate),
  'a JSA cannot be FILED already on hold', jsaCreate);
const jsaUpdate = allows(block('jsas'), 'update').join(' | ');
ok(/isOwner\(\)/.test(jsaUpdate), 'an owner can amend a JSA', jsaUpdate);
ok(!/isOffice\(\)/.test(jsaUpdate), 'office cannot amend a signed JSA', jsaUpdate);
ok(!/isTech\(\)/.test(jsaUpdate), 'no tech amends a filed JSA', jsaUpdate);
ok(/allow delete: if isOwner\(\);/.test((block('jsas') || '').replace(/\s+/g, ' ')),
  'only an owner deletes a JSA by hand');

/* ---- nobody promotes themselves -------------------------------------- */
const userUpdate = allows(block('users'), 'update').join(' | ');
ok(/request\.resource\.data\.role == resource\.data\.role/.test(userUpdate),
  'a person cannot change their own role', userUpdate);
ok(/request\.resource\.data\.active == resource\.data\.active/.test(userUpdate),
  'a person cannot switch themselves back on', userUpdate);

/* ---- a switched-off account is dead ----------------------------------- */
ok(/function active\(\)[\s\S]{0,120}active == true/.test(src),
  'there is an active() check and it tests the flag');
ok(/function isOwner\(\)\s*\{ return active\(\)/.test(src),
  'owner means active owner');
ok(/function isTech\(\)\s*\{ return active\(\)/.test(src),
  'tech means active tech');

/* ---- roles.js agrees -------------------------------------------------- */
HARD_RULES.forEach(r => {
  ok(!(GRANTS[r.role] || []).includes(r.cap),
    `roles.js: ${r.role} must not have ${r.cap}`, r.why);
});
ok(GRANTS.tech.length < GRANTS.office.length && GRANTS.office.length < GRANTS.owner.length,
  'the three staff roles widen in the order tech, office, owner');
Object.entries(GRANTS).forEach(([role, caps]) => {
  const dupes = caps.filter((c, i) => caps.indexOf(c) !== i);
  ok(dupes.length === 0, `${role} has no duplicated capabilities`, String(dupes));
});

/* ---- the Firebase project is actually wired up ------------------------ */
const cfg = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const field = n => (cfg.match(new RegExp(n + ":\\s*'([^']*)'")) || [, ''])[1];
const fb = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'storageBucket',
  'messagingSenderId', 'appId'].map(k => [k, field(k)]));
Object.entries(fb).forEach(([k, v]) =>
  ok(v.length > 0, `config.js has a ${k}`));
ok(/^AIza[\w-]{30,}$/.test(fb.apiKey), 'the API key has the shape Firebase issues');
ok(fb.authDomain === fb.projectId + '.firebaseapp.com',
  'the auth domain belongs to the same project', `${fb.authDomain} vs ${fb.projectId}`);
ok(fb.appId.startsWith(fb.messagingSenderId + ':') || fb.appId.includes(fb.messagingSenderId),
  'the app id belongs to the same project number', fb.appId);
ok(/:web:/.test(fb.appId), 'the registered app is a web app', fb.appId);
ok(cfg.includes("'bsds-app.github.io'") || cfg.includes('bsds-app.github.io'),
  'the app knows the domain it will be served from');

console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
