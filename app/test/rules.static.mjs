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

const COLLECTIONS = ['users', 'invites', 'customers', 'equipment', 'preops', 'jsas',
                     'receipts', 'partsRequests', 'partsOrders', 'workOrders',
                     'fcmTokens', 'reports', 'hr', 'books'];

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

/* ---- parts: a tech asks, he does not buy -----------------------------
   The status is the whole control here. A tech may correct his own
   request until somebody buys off it, and may never move it along. */
const prCreate = allows(block('partsRequests'), 'create').join(' | ');
ok(/request\.resource\.data\.status == 'open'/.test(prCreate),
  'a parts request is filed open, never pre-ordered', prCreate);
const prUpdate = allows(block('partsRequests'), 'update').join(' | ');
ok(/request\.resource\.data\.status == resource\.data\.status/.test(prUpdate),
  'a tech cannot move his own request along the statuses', prUpdate);
ok(/resource\.data\.status == 'open'/.test(prUpdate),
  'and cannot edit it once it has been ordered', prUpdate);
ok(/request\.resource\.data\.orderId == resource\.data\.orderId/.test(prUpdate),
  'nor attach it to a different order', prUpdate);
const poAll = (block('partsOrders') || '').replace(/\s+/g, ' ');
ok(/allow read, write: if isOwner\(\) \|\| isOffice\(\);/.test(poAll),
  'orders are office and owners only', poAll);
ok(!/isTech\(\)/.test(poAll), 'no tech reaches the orders', poAll);

/* ---- work orders: the service order number is the office's ------------ */
const woCreate = allows(block('workOrders'), 'create').join(' | ');
ok(/request\.resource\.data\.status == 'open'/.test(woCreate),
  'a work order is rung in open', woCreate);
ok(/request\.resource\.data\.soNumber == ''/.test(woCreate),
  'and without a service order number on it', woCreate);
const woUpdate = allows(block('workOrders'), 'update').join(' | ');
ok(/request\.resource\.data\.soNumber == resource\.data\.soNumber/.test(woUpdate),
  'a tech cannot write the service order number', woUpdate);
ok(/request\.resource\.data\.status == resource\.data\.status/.test(woUpdate),
  'nor move it along', woUpdate);
ok(/resource\.data\.status == 'open'/.test(woUpdate),
  'nor edit it once it has been built', woUpdate);
const woRead = allows(block('workOrders'), 'read').join(' | ');
ok(/assignedUid == request\.auth\.uid/.test(woRead),
  'a tech sees one an owner assigned him', woRead);
ok(/mine\(resource\.data\)/.test(woRead), 'and the ones he rang in', woRead);
ok(!/\bstaff\(\)/.test(woRead), 'but not everybody else\u2019s', woRead);

/* the capability matrix has to agree about who rings one in */
ok(GRANTS.tech.includes('wo.request') && !GRANTS.tech.includes('wo.manage'),
  'a tech rings work orders in and does not work the list');
ok(GRANTS.office.includes('wo.manage') && !GRANTS.office.includes('wo.request'),
  'office works the list and does not ring them in');
ok(GRANTS.owner.includes('wo.request') && GRANTS.owner.includes('wo.manage'),
  'an owner does both');

/* ---- nobody promotes themselves -------------------------------------- */
/* The pinning lives in a named function now, so check the function says
   what it must AND that the self branch of the update rule uses it. */
ok(/function unchangedRoleAndActive\(\)[\s\S]{0,200}request\.resource\.data\.role == resource\.data\.role/
  .test(src), 'the pin covers role');
ok(/function unchangedRoleAndActive\(\)[\s\S]{0,200}request\.resource\.data\.active == resource\.data\.active/
  .test(src), 'the pin covers the active flag');
const userUpdate = allows(block('users'), 'update').join(' | ');
ok(/uid == request\.auth\.uid && unchangedRoleAndActive\(\)/.test(userUpdate),
  'editing your own record cannot change your role or switch you back on', userUpdate);

/* ---- and an owner cannot lock themselves out --------------------------
   The one account an owner may not change is their own. Without this an
   owner can, in two clicks, leave the company with no way into its own
   app - and the fix for that is a console session nobody wants to need. */
['update', 'create', 'delete'].forEach(verb => {
  const r = allows(block('users'), verb).join(' | ');
  ok(/isOwner\(\) && uid != request\.auth\.uid/.test(r),
    `an owner cannot ${verb} their own record`, r);
});

/* ---- office reads the roster, and only reads it -----------------------
   Mike opened this in Oct 2026 so that an assignment office makes lands on
   the tech's phone. The line between reading and running it is the whole
   point, so it is pinned from both sides. */
const userRead = allows(block('users'), 'read').join(' | ');
ok(/isOffice\(\)/.test(userRead), 'office reads the roster', userRead);
ok(!/\bstaff\(\)|isTech\(\)/.test(userRead),
  'a tech still does not get the staff list', userRead);
ok(!/isOffice\(\)/.test(allows(block('users'), 'delete').join(' | ')),
  'and office deletes nobody');
ok(!/isOffice\(\)/.test(userUpdate.split('||')[0]),
  'and office is not in the everybody-else branch of the update rule', userUpdate);
ok(GRANTS.office.includes('users.read') && !GRANTS.office.includes('users.manage'),
  'the matrix says office reads the roster and does not run it');
ok(!GRANTS.tech.includes('users.read'), 'and a tech reads none of it');
ok(/isOwner\(\)/.test(allows(block('hr'), 'read').join(' | '))
  && !/isOffice\(\)/.test(allows(block('hr'), 'read').join(' | ')),
  'the personnel file is a different collection and is still owners-only');

/* ---- invitations are how somebody gets added -------------------------- */
const invites = (block('invites') || '').replace(/\s+/g, ' ');
ok(invites.length > 0, 'there is a rule block for invites');
ok(/allow read, write: if isOwner\(\);/.test(invites),
  'only an owner writes an invitation', invites);
ok(/email == request\.auth\.token\.email\.lower\(\)/.test(invites),
  'the invited person reaches only the invitation bearing their own address', invites);
ok(!/staff\(\)|isOffice\(\)|isTech\(\)/.test(invites),
  'nobody else can read who is being hired', invites);

const userCreate = allows(block('users'), 'create').join(' | ');
ok(/request\.resource\.data\.role == invitedAs\(\)\.role/.test(userCreate),
  'a person admits themselves only at the role the invitation names', userCreate);
ok(/request\.resource\.data\.active == true/.test(userCreate),
  'and only as an active account, never pre-switched-off', userCreate);
ok(/function invitedAs\(\)[\s\S]{0,200}invites\/\$\(request\.auth\.token\.email\.lower\(\)\)/
  .test(src), 'the invitation is looked up by the signed-in address, not one supplied by the client');

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

/* ---- every query the app makes has an index to run on -----------------
   A tech's "my own paperwork" screen filters by uid AND sorts by date.
   Firestore refuses that pair without a composite index, and the refusal
   arrives as an error - which on screen looks exactly like "you have not
   filed any", i.e. like success. So the index file is checked against the
   queries rather than trusted. */
const idx = JSON.parse(fs.readFileSync(new URL('../firestore.indexes.json',
  import.meta.url), 'utf8'));
[['preops', 'inspDate', '../preop.js'], ['jsas', 'jsaDate', '../jsa.js'],
 ['partsRequests', 'createdAt', '../parts.js'],
 ['workOrders', 'createdAt', '../workorders.js']]
  .forEach(([coll, dateField, src]) => {
    const code = fs.readFileSync(new URL(src, import.meta.url), 'utf8');
    const filters = /m\.where\('uid', '==', u\.uid\)/.test(code);
    const sorts = new RegExp("m\\.orderBy\\('" + dateField + "'").test(code);
    ok(filters && sorts, `${coll}: the log really does filter by uid and sort by date`,
      `filter=${filters} sort=${sorts}`);
    const hit = (idx.indexes || []).find(i => i.collectionGroup === coll
      && i.fields.length === 2
      && i.fields[0].fieldPath === 'uid' && i.fields[0].order === 'ASCENDING'
      && i.fields[1].fieldPath === dateField && i.fields[1].order === 'DESCENDING');
    ok(!!hit, `${coll}: there is a (uid, ${dateField} desc) composite index`,
      JSON.stringify((idx.indexes || []).map(i => i.collectionGroup)));
  });

/* the tech's work-order list runs TWO queries - his own and ones assigned
   to him - so both branches need an index, not just the obvious one. */
ok((idx.indexes || []).some(i => i.collectionGroup === 'workOrders'
  && i.fields[0].fieldPath === 'assignedUid'),
  'workOrders: the assigned-to-me branch has an index too');

/* the CLI needs to know which project and where the files are */
const fbj = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
ok(fbj.firestore && fbj.firestore.rules === 'firestore.rules',
  'firebase.json points at the rules file in this folder');
ok(fbj.firestore && fbj.firestore.indexes === 'firestore.indexes.json',
  'firebase.json points at the index file in this folder');
const rc = JSON.parse(fs.readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
ok(rc.projects && rc.projects.default === 'bsds-app',
  'the default project is bsds-app, so a deploy cannot go to the wrong one',
  JSON.stringify(rc.projects));

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
