/* The permission rules, run against a real Firestore.
 *
 * roles.js decides what the app draws. This file proves the database would
 * refuse the same things if somebody skipped the app entirely - which is the
 * only version of "techs cannot see the master log" that is worth anything.
 */
import fs from 'fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, collection, getDocs, deleteDoc,
} from 'firebase/firestore';
import { HARD_RULES, GRANTS } from '../roles.js';

let pass = 0, fail = 0;
const bad = [];
async function ok(name, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; bad.push(name + ' :: ' + (e.message || e)); }
}

const USERS = {
  mike:  { role: 'owner',  active: true, name: 'Mike' },
  stew:  { role: 'owner',  active: true, name: 'Stew' },
  jaz:   { role: 'office', active: true, name: 'Jazmine' },
  clint: { role: 'tech',   active: true, name: 'Clint' },
  noah:  { role: 'tech',   active: true, name: 'Noah' },
  gone:  { role: 'tech',   active: false, name: 'Left last year' },
  newby: null,                       // signed in, never admitted
};

const env = await initializeTestEnvironment({
  projectId: 'bsds-rules-test',
  firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

/* seed the user documents and one of every record, rules off */
await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  for (const [uid, u] of Object.entries(USERS)) {
    if (u) await setDoc(doc(d, 'users', uid), u);
  }
  await setDoc(doc(d, 'customers/wesco-ut'), { name: 'WESCO - UT' });
  await setDoc(doc(d, 'equipment/wesco-ut--70165'), { unit: '70165', serial: '70165' });
  /* A pre-op carries the four fields the retention rules turn on, so the
     seeds carry them too - a test fixture that is missing them would pass
     rules that a real record would fail. p1 is clean and has an expiry;
     p2 has a defect still open, which is why its expiry is null. */
  await setDoc(doc(d, 'preops/p1'),  { uid: 'clint', unit: '70165', hold: false,
    formVersion: 1, inspDate: new Date('2026-10-18T07:00:00Z'),
    expiresAt: new Date('2027-11-17T07:00:00Z'),
    items: [{ s: 'Fluids & Engine', i: 'Engine oil level', r: 'pass', n: '' }] });
  await setDoc(doc(d, 'preops/p2'),  { uid: 'noah',  unit: '8619', hold: false,
    formVersion: 1, inspDate: new Date('2026-10-19T07:00:00Z'), expiresAt: null,
    items: [{ s: 'Safety & Controls', i: 'Horn functioning', r: 'fail', n: 'dead' }] });
  /* JSAs carry the fields their retention rules turn on, same as the
     pre-ops. j1 is an ordinary one; j2 opened a confined-space permit. */
  await setDoc(doc(d, 'jsas/j1'), { uid: 'clint', taskDesc: 'tower work', hold: false,
    formVersion: 1, jsaDate: new Date('2026-10-18T07:00:00Z'),
    expiresAt: new Date('2027-11-17T07:00:00Z'), permitsOpen: [] });
  await setDoc(doc(d, 'jsas/j2'), { uid: 'noah', taskDesc: 'compressor', hold: false,
    formVersion: 1, jsaDate: new Date('2026-10-19T07:00:00Z'),
    expiresAt: new Date('2027-11-18T07:00:00Z'), permitsOpen: ['confined'] });
  await setDoc(doc(d, 'receipts/r1'), { uid: 'clint', amount: 42 });
  await setDoc(doc(d, 'partsRequests/q1'), { uid: 'clint', status: 'open', orderId: '',
    unit: '70165', lines: [{ pn: '', qty: 2, desc: '51mm button bit' }] });
  await setDoc(doc(d, 'partsRequests/q2'), { uid: 'clint', status: 'ordered',
    orderId: 'o1', unit: '8619', lines: [{ pn: 'R32-BIT-51', qty: 1, desc: 'Shank' }] });
  await setDoc(doc(d, 'partsOrders/o1'), { total: 1 });
  await setDoc(doc(d, 'reports/rep1'), { kind: 'ar-aging' });
  await setDoc(doc(d, 'hr/clint'), { ssnOnFile: true });
  await setDoc(doc(d, 'books/70165'), { title: 'DM45-HP 70165' });
  /* an invitation waiting to be claimed, and one for somebody else */
  await setDoc(doc(d, 'invites/dale@bsds.local'),
    { name: 'Dale', email: 'dale@bsds.local', role: 'tech', by: 'Mike' });
  await setDoc(doc(d, 'invites/pat@bsds.local'),
    { name: 'Pat', email: 'pat@bsds.local', role: 'office', by: 'Mike' });
});

const as = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/* ---- the five rules Mike set, stated as refusals ---------------------- */
await ok('a tech cannot read the pre-op master log', async () => {
  await assertFails(getDocs(collection(as('clint'), 'preops')));
  await assertFails(getDoc(doc(as('clint'), 'preops/p2')));   // someone else's
});
await ok('a tech cannot read the receipts log', async () => {
  await assertFails(getDocs(collection(as('clint'), 'receipts')));
  await assertFails(getDoc(doc(as('clint'), 'receipts/r1'))); // not even their own
});
await ok('a tech cannot read the JSA archive', async () => {
  await assertFails(getDocs(collection(as('clint'), 'jsas')));
  await assertFails(getDoc(doc(as('clint'), 'jsas/j2')));
});
await ok('personnel is owners only', async () => {
  await assertFails(getDoc(doc(as('clint'), 'hr/clint')));
  await assertFails(getDoc(doc(as('jaz'), 'hr/clint')));
  await assertSucceeds(getDoc(doc(as('mike'), 'hr/clint')));
});

/* ---- what the techs CAN do, so the rules are not just a wall ---------- */
const sheet = (uid, extra) => ({
  uid, unit: '70165', hold: false, formVersion: 1,
  inspDate: new Date('2026-10-20T07:00:00Z'),
  expiresAt: new Date('2027-11-19T07:00:00Z'),
  items: [{ s: 'Fluids & Engine', i: 'Engine oil level', r: 'pass', n: '' }],
  ...(extra || {}),
});

await ok('a tech files a pre-op and reads their own back', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'preops/p3'), sheet('clint')));
  await assertSucceeds(getDoc(doc(as('clint'), 'preops/p1')));
});
await ok('a tech cannot file a pre-op in someone else’s name', async () => {
  await assertFails(setDoc(doc(as('clint'), 'preops/p4'), sheet('noah', { unit: '8619' })));
});

/* ---- retention: the things that must not be deletable ------------------
   The purge is a TTL policy on expiresAt and runs server-side, outside
   these rules. So what the rules have to protect is the FIELD: a record
   must not be filed already held, and only an owner may change the hold
   or restamp the record. Everything below is about that. */
await ok('a pre-op cannot be filed already on hold', async () => {
  await assertFails(setDoc(doc(as('clint'), 'preops/p5'), sheet('clint', { hold: true })));
});
await ok('a tech cannot amend a sheet once it is filed', async () => {
  await assertFails(setDoc(doc(as('clint'), 'preops/p1'),
    sheet('clint', { items: [{ s: 'x', i: 'y', r: 'pass', n: '' }] })));
});
await ok('office signs a defect off as corrected', async () => {
  await assertSucceeds(setDoc(doc(as('jaz'), 'preops/p2'), {
    uid: 'noah', unit: '8619', hold: false, formVersion: 1,
    inspDate: new Date('2026-10-19T07:00:00Z'),
    expiresAt: new Date('2027-11-18T07:00:00Z'),
    items: [{ s: 'Safety & Controls', i: 'Horn functioning', r: 'fail', n: 'dead',
              c: true, cBy: 'Jazmine' }],
  }));
});
await ok('office cannot put a record on legal hold', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'preops/p1'), sheet('clint', { hold: true })));
});
await ok('office cannot move the inspection date', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'preops/p1'),
    sheet('clint', { inspDate: new Date('2026-01-01T07:00:00Z') })));
});
await ok('office cannot restamp a record with another form version', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'preops/p1'), sheet('clint', { formVersion: 2 })));
});
await ok('office cannot reassign whose record it is', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'preops/p1'), sheet('noah')));
});
await ok('an owner puts a hold on, which takes the expiry off', async () => {
  await assertSucceeds(setDoc(doc(as('mike'), 'preops/p1'),
    sheet('clint', { hold: true, holdReason: 'incident', expiresAt: null })));
  await env.withSecurityRulesDisabled(async (c) =>
    setDoc(doc(c.firestore(), 'preops/p1'), sheet('clint')));
});
await ok('only an owner deletes a pre-op by hand', async () => {
  await assertFails(deleteDoc(doc(as('clint'), 'preops/p1')));
  await assertFails(deleteDoc(doc(as('jaz'), 'preops/p1')));
  await assertSucceeds(deleteDoc(doc(as('mike'), 'preops/p3')));
});
await ok('a tech sends a receipt in and cannot read it back', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'receipts/r9'), { uid: 'clint', amount: 7 }));
  await assertFails(getDoc(doc(as('clint'), 'receipts/r9')));
});
await ok('a tech reads their own JSA but not another tech’s', async () => {
  await assertSucceeds(getDoc(doc(as('clint'), 'jsas/j1')));
  await assertFails(getDoc(doc(as('clint'), 'jsas/j2')));
});
await ok('a tech can look any machine up', async () => {
  await assertSucceeds(getDoc(doc(as('clint'), 'equipment/wesco-ut--70165')));
  await assertSucceeds(getDoc(doc(as('clint'), 'customers/wesco-ut')));
  await assertSucceeds(getDoc(doc(as('clint'), 'books/70165')));
});
await ok('a tech cannot rewrite the equipment list', async () => {
  await assertFails(setDoc(doc(as('clint'), 'equipment/wesco-ut--70165'), { unit: 'nope' }));
});
await ok('a tech requests parts and watches their own request', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'partsRequests/q9'),
    { uid: 'clint', status: 'open', orderId: '' }));
  await assertSucceeds(getDoc(doc(as('clint'), 'partsRequests/q1')));
  await assertFails(getDoc(doc(as('clint'), 'partsOrders/o1')));
});

/* ---- the JSA, and the permits on it ----------------------------------- */
const jsa = (uid, extra) => ({
  uid, taskDesc: 'replace rotary head seal kit', hold: false, formVersion: 1,
  jsaDate: new Date('2026-10-20T07:00:00Z'),
  expiresAt: new Date('2027-11-19T07:00:00Z'),
  permitsOpen: [],
  ...(extra || {}),
});

await ok('a tech files a JSA and reads their own back', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'jsas/j3'), jsa('clint')));
  await assertSucceeds(getDoc(doc(as('clint'), 'jsas/j1')));
});
await ok('a tech cannot file a JSA in someone else\u2019s name', async () => {
  await assertFails(setDoc(doc(as('clint'), 'jsas/j4'), jsa('noah')));
});
await ok('a JSA cannot be filed already on hold', async () => {
  await assertFails(setDoc(doc(as('clint'), 'jsas/j5'), jsa('clint', { hold: true })));
});
await ok('a tech cannot amend a JSA once it is signed', async () => {
  await assertFails(setDoc(doc(as('clint'), 'jsas/j1'),
    jsa('clint', { taskDesc: 'something else' })));
});
await ok('office reads every JSA but amends none', async () => {
  await assertSucceeds(getDoc(doc(as('jaz'), 'jsas/j2')));
  await assertFails(setDoc(doc(as('jaz'), 'jsas/j1'), jsa('clint')));
});
await ok('office cannot put a JSA on legal hold', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'jsas/j1'), jsa('clint', { hold: true })));
});
await ok('an owner holds a JSA, which takes the expiry off', async () => {
  await assertSucceeds(setDoc(doc(as('mike'), 'jsas/j1'),
    jsa('clint', { hold: true, holdReason: 'tank entry incident', expiresAt: null })));
  await env.withSecurityRulesDisabled(async (c) =>
    setDoc(doc(c.firestore(), 'jsas/j1'), jsa('clint')));
});
await ok('only an owner deletes a JSA by hand', async () => {
  await assertFails(deleteDoc(doc(as('clint'), 'jsas/j1')));
  await assertFails(deleteDoc(doc(as('jaz'), 'jsas/j1')));
  await assertSucceeds(deleteDoc(doc(as('mike'), 'jsas/j3')));
});

/* ---- parts: a tech asks, he does not buy ------------------------------- */
const req = (extra) => ({ uid: 'clint', status: 'open', orderId: '', unit: '70165',
  lines: [{ pn: '', qty: 2, desc: '51mm button bit' }], ...(extra || {}) });

await ok('a tech raises a request and reads his own back', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'partsRequests/q5'), req()));
  await assertSucceeds(getDoc(doc(as('clint'), 'partsRequests/q1')));
});
await ok('a request cannot be raised already ordered', async () => {
  await assertFails(setDoc(doc(as('clint'), 'partsRequests/q6'),
    req({ status: 'ordered', orderId: 'o1' })));
});
await ok('a tech cannot mark his own request ordered', async () => {
  await assertFails(setDoc(doc(as('clint'), 'partsRequests/q1'),
    req({ status: 'ordered' })));
});
await ok('a tech cannot attach his request to an order', async () => {
  await assertFails(setDoc(doc(as('clint'), 'partsRequests/q1'),
    req({ orderId: 'o1' })));
});
await ok('a tech can fix his own request while it is still open', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'partsRequests/q1'),
    req({ lines: [{ pn: 'R32-BIT-51', qty: 2, desc: '51mm button bit' }] })));
});
await ok('but not once it has been ordered', async () => {
  await assertFails(setDoc(doc(as('clint'), 'partsRequests/q2'),
    { uid: 'clint', status: 'ordered', orderId: 'o1', unit: '8619',
      lines: [{ pn: 'CHANGED', qty: 9, desc: 'nope' }] }));
});
await ok('a tech cannot read another tech\u2019s request', async () => {
  await assertFails(getDocs(collection(as('noah'), 'partsRequests')));
  await assertFails(getDoc(doc(as('noah'), 'partsRequests/q1')));
});
await ok('office works the queue and the orders', async () => {
  await assertSucceeds(getDocs(collection(as('jaz'), 'partsRequests')));
  await assertSucceeds(setDoc(doc(as('jaz'), 'partsRequests/q1'),
    req({ status: 'ordered', orderId: 'o9' })));
  await assertSucceeds(setDoc(doc(as('jaz'), 'partsOrders/o9'),
    { vendor: 'Mincon Inc.', po: 'PO-4471', status: 'placed', requestIds: ['q1'] }));
});
await ok('no tech goes near an order', async () => {
  await assertFails(getDoc(doc(as('clint'), 'partsOrders/o9')));
  await assertFails(getDocs(collection(as('clint'), 'partsOrders')));
  await assertFails(setDoc(doc(as('clint'), 'partsOrders/o8'), { vendor: 'x' }));
});

/* ---- office ----------------------------------------------------------- */
await ok('office works the receipts and the logs', async () => {
  await assertSucceeds(getDocs(collection(as('jaz'), 'receipts')));
  await assertSucceeds(getDocs(collection(as('jaz'), 'preops')));
  await assertSucceeds(getDocs(collection(as('jaz'), 'jsas')));
  await assertSucceeds(getDoc(doc(as('jaz'), 'reports/rep1')));
});
await ok('office cannot restructure the equipment list', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'equipment/x'), { unit: 'x' }));
});

/* ---- nobody promotes themselves --------------------------------------- */
await ok('a tech cannot make themselves an owner', async () => {
  await assertFails(setDoc(doc(as('clint'), 'users/clint'),
    { role: 'owner', active: true, name: 'Clint' }));
});
await ok('a tech cannot switch themselves back on', async () => {
  await assertFails(setDoc(doc(as('gone'), 'users/gone'),
    { role: 'tech', active: true, name: 'Left last year' }));
});
await ok('a tech can fix their own name', async () => {
  await assertSucceeds(setDoc(doc(as('clint'), 'users/clint'),
    { role: 'tech', active: true, name: 'Clint W' }));
});
await ok('an owner sets roles', async () => {
  await assertSucceeds(setDoc(doc(as('mike'), 'users/clint'),
    { role: 'office', active: true, name: 'Clint W' }));
  await env.withSecurityRulesDisabled(async (c) =>
    setDoc(doc(c.firestore(), 'users/clint'), USERS.clint));
});

/* ---- an owner cannot lock themselves out -------------------------------
   The screen hides the controls; this is the half that counts. Mike can
   demote Stew and Stew can demote Mike, but neither can do it to himself,
   so no sequence of clicks ends with nobody able to get in. */
await ok('an owner cannot change their own role', async () => {
  await assertFails(setDoc(doc(as('mike'), 'users/mike'),
    { role: 'tech', active: true, name: 'Mike' }));
});
await ok('an owner cannot switch themselves off', async () => {
  await assertFails(setDoc(doc(as('mike'), 'users/mike'),
    { role: 'owner', active: false, name: 'Mike' }));
});
await ok('an owner cannot delete their own record', async () => {
  await assertFails(deleteDoc(doc(as('mike'), 'users/mike')));
});
await ok('but another owner can', async () => {
  await assertSucceeds(setDoc(doc(as('stew'), 'users/mike'),
    { role: 'owner', active: true, name: 'Mike Clunas' }));
});
await ok('an owner can still fix their own name', async () => {
  await assertSucceeds(setDoc(doc(as('mike'), 'users/mike'),
    { role: 'owner', active: true, name: 'Mike C' }));
  await env.withSecurityRulesDisabled(async (c) =>
    setDoc(doc(c.firestore(), 'users/mike'), USERS.mike));
});

/* ---- invitations ------------------------------------------------------
   How somebody gets added without a console session. The invitation is
   the admitting act; setting a password is not. */
const asEmail = (uid, email) =>
  env.authenticatedContext(uid, { email, email_verified: true }).firestore();

await ok('nobody but an owner can read who is being hired', async () => {
  await assertFails(getDocs(collection(as('clint'), 'invites')));
  await assertFails(getDocs(collection(as('jaz'), 'invites')));
  await assertFails(getDoc(doc(as('clint'), 'invites/dale@bsds.local')));
  await assertSucceeds(getDocs(collection(as('mike'), 'invites')));
});
await ok('office cannot invite anybody', async () => {
  await assertFails(setDoc(doc(as('jaz'), 'invites/x@bsds.local'),
    { name: 'X', email: 'x@bsds.local', role: 'owner' }));
});
await ok('an invited person reads only their own invitation', async () => {
  const dale = asEmail('dale', 'dale@bsds.local');
  await assertSucceeds(getDoc(doc(dale, 'invites/dale@bsds.local')));
  await assertFails(getDoc(doc(dale, 'invites/pat@bsds.local')));
});
await ok('an invited person admits themselves at the invited role', async () => {
  const dale = asEmail('dale', 'dale@bsds.local');
  await assertSucceeds(setDoc(doc(dale, 'users/dale'),
    { name: 'Dale', role: 'tech', active: true, email: 'dale@bsds.local' }));
  await assertSucceeds(deleteDoc(doc(dale, 'invites/dale@bsds.local')));
});
await ok('and cannot help themselves to a bigger one', async () => {
  const pat = asEmail('pat', 'pat@bsds.local');
  await assertFails(setDoc(doc(pat, 'users/pat'),
    { name: 'Pat', role: 'owner', active: true, email: 'pat@bsds.local' }));
});
await ok('somebody with no invitation admits nobody', async () => {
  const rando = asEmail('rando', 'rando@elsewhere.com');
  await assertFails(setDoc(doc(rando, 'users/rando'),
    { name: 'Rando', role: 'tech', active: true, email: 'rando@elsewhere.com' }));
  await assertFails(getDoc(doc(rando, 'equipment/wesco-ut--70165')));
});
await ok('and cannot write a record for somebody else', async () => {
  const pat = asEmail('pat', 'pat@bsds.local');
  await assertFails(setDoc(doc(pat, 'users/clint'),
    { name: 'Clint', role: 'owner', active: true }));
});

/* ---- switched off, never admitted, and not signed in at all ------------ */
await ok('somebody switched off gets nothing', async () => {
  await assertFails(getDoc(doc(as('gone'), 'equipment/wesco-ut--70165')));
  await assertFails(setDoc(doc(as('gone'), 'preops/p8'), { uid: 'gone' }));
});
await ok('a signed-in account with no role gets nothing', async () => {
  await assertFails(getDoc(doc(as('newby'), 'equipment/wesco-ut--70165')));
});
await ok('a stranger gets nothing', async () => {
  await assertFails(getDoc(doc(anon(), 'equipment/wesco-ut--70165')));
  await assertFails(getDoc(doc(anon(), 'users/mike')));
});
await ok('nothing outside the named collections is open', async () => {
  await assertFails(getDoc(doc(as('mike'), 'secrets/s1')));
  await assertFails(setDoc(doc(as('mike'), 'secrets/s1'), { a: 1 }));
});

/* ---- the matrix in roles.js and these rules must agree ----------------- */
await ok('every hard rule in roles.js is a denial here too', async () => {
  for (const r of HARD_RULES) {
    if ((GRANTS[r.role] || []).includes(r.cap)) {
      throw new Error(`roles.js grants ${r.role} the capability it must not have: ${r.cap}`);
    }
  }
});

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
