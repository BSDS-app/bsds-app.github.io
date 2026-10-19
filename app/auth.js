/* Sign-in, and the one question the rest of the app asks: who is this and
 * what may they see?
 *
 * Two implementations behind one interface. The live one is Firebase Auth
 * plus a users/{uid} document that carries the role. The demo one keeps a
 * name in sessionStorage so the screens can be walked through before the
 * project exists. Nothing above this file knows which is running.
 */
import { CONFIG, DEMO } from './config.js';
import { can } from './roles.js';

const DEMO_PEOPLE = [
  { uid: 'demo-mike',  name: 'Mike Clunas', role: 'owner',  email: 'mike@brokenspokedrilling.com' },
  { uid: 'demo-stew',  name: 'Stew Roth',   role: 'owner',  email: 'stew@brokenspokedrilling.com' },
  { uid: 'demo-jaz',   name: 'Jazmine',     role: 'office', email: 'ap@brokenspokedrilling.com' },
  { uid: 'demo-clint', name: 'Clint',       role: 'tech',   email: 'clint@bsds.local' },
  { uid: 'demo-noah',  name: 'Noah',        role: 'tech',   email: 'noah@bsds.local' },
];

let user = null;
const listeners = [];

function emit() { listeners.forEach(fn => fn(user)); }

export function onUser(fn) {
  listeners.push(fn);
  fn(user);
  return () => listeners.splice(listeners.indexOf(fn), 1);
}

export function currentUser() { return user; }

export function allow(cap) {
  return !!user && user.active !== false && can(user.role, cap);
}

/* ---------- demo ----------------------------------------------------- */

export function demoPeople() { return DEMO_PEOPLE; }

function restoreDemo() {
  try {
    const uid = sessionStorage.getItem('bsds.demoUser');
    const p = DEMO_PEOPLE.find(x => x.uid === uid);
    if (p) { user = { ...p, demo: true }; }
  } catch (e) { /* private window - start signed out */ }
}

export function demoSignIn(uid) {
  const p = DEMO_PEOPLE.find(x => x.uid === uid);
  if (!p) throw new Error('no such demo user');
  user = { ...p, demo: true };
  try { sessionStorage.setItem('bsds.demoUser', uid); } catch (e) {}
  emit();
}

/* ---------- live ------------------------------------------------------ */

let fb = null;

async function loadFirebase() {
  if (fb) return fb;
  const V = '10.12.2';
  const [app, auth, store] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(CONFIG.firebase);
  fb = { app: a, auth: auth.getAuth(a), db: store.getFirestore(a), authMod: auth, storeMod: store };
  return fb;
}

export function isWorkspaceEmail(email) {
  const at = String(email || '').split('@')[1] || '';
  return CONFIG.workspaceDomains.includes(at.toLowerCase());
}

export async function signInGoogle() {
  const { auth, authMod } = await loadFirebase();
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ hd: CONFIG.workspaceDomains[0] || '' });
  await authMod.signInWithPopup(auth, provider);
}

export async function signInPassword(email, password) {
  const { auth, authMod } = await loadFirebase();
  await authMod.signInWithEmailAndPassword(auth, email, password);
}

export async function sendReset(email) {
  const { auth, authMod } = await loadFirebase();
  await authMod.sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  if (DEMO) {
    user = null;
    try { sessionStorage.removeItem('bsds.demoUser'); } catch (e) {}
    emit();
    return;
  }
  const { auth, authMod } = await loadFirebase();
  await authMod.signOut(auth);
}

/* A signed-in account with no users/{uid} document has no role, which is
 * not an error: it is somebody an owner has not admitted yet, and the app
 * says so rather than failing open. */
export async function start() {
  if (DEMO) { restoreDemo(); emit(); return; }
  const { auth, db, authMod, storeMod } = await loadFirebase();
  authMod.onAuthStateChanged(auth, async (acct) => {
    if (!acct) { user = null; emit(); return; }
    let profile = null;
    try {
      const snap = await storeMod.getDoc(storeMod.doc(db, 'users', acct.uid));
      profile = snap.exists() ? snap.data() : null;
    } catch (e) {
      profile = null;
    }
    user = profile
      ? { uid: acct.uid, email: acct.email, name: profile.name || acct.displayName || acct.email,
          role: profile.role, active: profile.active !== false }
      : { uid: acct.uid, email: acct.email, name: acct.displayName || acct.email,
          role: null, active: false, pending: true };
    emit();
  });
}

export async function db() {
  const { db: d, storeMod } = await loadFirebase();
  return { d, m: storeMod };
}
