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

/* A tech setting their password for the first time.
 *
 * This creates a sign-in account and nothing else. It does not admit
 * anybody: an account with no users record sees the "nobody has given this
 * account a role yet" screen, and firestore.rules hands it nothing. What
 * admits somebody is an invitation an owner wrote against their email
 * address, which claim() below turns into their user record. So the worst a
 * stranger can do here is leave an unusable account in the list. */
export async function signUpPassword(email, password) {
  const { auth, authMod } = await loadFirebase();
  await authMod.createUserWithEmailAndPassword(auth, email, password);
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
/* Turn an invitation into a user record, once, on first sign-in.
 *
 * Returns the new profile, or null if there was no invitation - which is
 * not an error, it is somebody nobody has admitted. The rules allow this
 * write only when the role being claimed matches the role the invitation
 * names, so a person cannot sign themselves in as an owner by editing what
 * the browser sends. */
async function claim(acct, db, m) {
  const key = String(acct.email || '').toLowerCase();
  if (!key) return null;
  let inv = null;
  try {
    const snap = await m.getDoc(m.doc(db, 'invites', key));
    inv = snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
  if (!inv || !inv.role) return null;
  const profile = {
    name: inv.name || acct.displayName || acct.email,
    role: inv.role,
    active: true,
    email: acct.email || '',
    admittedAt: new Date().toISOString(),
    admittedBy: inv.by || '',
  };
  await m.setDoc(m.doc(db, 'users', acct.uid), profile);
  /* Clearing it is tidiness, not security - the record now decides. If the
     delete fails the person is still admitted, so it is not worth failing
     the sign-in over. */
  try { await m.deleteDoc(m.doc(db, 'invites', key)); } catch (e) {}
  return profile;
}

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
    /* No record yet? They may have been invited. */
    if (!profile) {
      try { profile = await claim(acct, db, storeMod); } catch (e) { profile = null; }
    } else if (acct.email && profile.email !== acct.email) {
      /* Keep the address on the record current, so the People screen can
         show it for somebody other than whoever is looking. Harmless if it
         fails - the rules let a person edit their own name and email and
         nothing else. */
      try {
        await storeMod.updateDoc(storeMod.doc(db, 'users', acct.uid), { email: acct.email });
        profile = { ...profile, email: acct.email };
      } catch (e) {}
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
