/* Turning the home-screen band into something that reaches a phone.
 *
 * READ THIS BEFORE WIDENING IT. The band in alerts.js can afford to list
 * things; a notification cannot. Mike's instruction was exact: "i want
 * notifications on down things. just the others i want them just sitting
 * for me." So exactly two things buzz - a rig down waiting on parts, and a
 * work order rung in - and everything else stays on the band where it can
 * be read when somebody chooses to read it.
 *
 * The decision about WHO gets which push is not here. It is in the Cloud
 * Function, which resolves the audience from the users collection at the
 * moment it sends. That is deliberate: if the role lived on the token
 * document it would be a copy, and a copy goes stale the day somebody
 * changes jobs - which is the day it matters.
 *
 * WHAT THIS FILE CANNOT DO. iOS only delivers web push to a page that has
 * been ADDED TO THE HOME SCREEN, on iOS 16.4 or newer. In a Safari tab
 * there is no permission to ask for and no token to get - not because of
 * anything written here, and there is no way around it. iosNeedsInstall()
 * below detects that case so the screen can say so plainly instead of
 * showing a button that cannot work.
 */
import { CONFIG } from './config.js';
import * as auth from './auth.js';

const V = '10.12.2';
const LOCAL = 'bsds.pushToken';

export function supported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'Notification' in window
    && 'PushManager' in window;
}

/* An iPhone in a Safari tab, as opposed to one on the home screen. The
   test is standalone mode, not the user agent: a home-screen app reports
   standalone and a tab does not, whatever the browser calls itself. */
export function iosNeedsInstall() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone = window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return !standalone;
}

export function permission() {
  if (!supported()) return 'unsupported';
  return Notification.permission;   /* default | granted | denied */
}

export function tokenOnFile() {
  try { return sessionStorage.getItem(LOCAL) || localStorage.getItem(LOCAL) || ''; }
  catch (e) { return ''; }
}

function remember(t) {
  try { localStorage.setItem(LOCAL, t); } catch (e) { /* private mode */ }
}
function forget() {
  try { localStorage.removeItem(LOCAL); } catch (e) { /* ignore */ }
}

async function messagingMod() {
  return import(`https://www.gstatic.com/firebasejs/${V}/firebase-messaging.js`);
}

/* Registered with an explicit scope so the Launcher at the site root is
   left alone. Without the scope a worker at /app/sw.js would still only
   claim /app/, but saying it out loud means a later move of this file
   cannot quietly widen what it controls. */
async function register() {
  return navigator.serviceWorker.register('./sw.js', { scope: './' });
}

/* ---------- switching it on ------------------------------------------- */

export async function enable() {
  if (!supported()) throw new Error('This browser cannot do notifications.');
  if (iosNeedsInstall()) {
    throw new Error('On an iPhone, notifications only work once the app is on '
      + 'your home screen. Share → Add to Home Screen, open it from there, '
      + 'then turn this on.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Your phone is set to block notifications from this app. That has to '
        + 'be changed in the phone settings, not here.'
      : 'Nothing was allowed, so nothing will be sent.');
  }
  const reg = await register();
  const { getMessaging, getToken } = await messagingMod();
  const { app } = await auth.firebase();
  const token = await getToken(getMessaging(app), {
    vapidKey: CONFIG.push.vapidKey,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error('The browser would not hand out a push token.');
  await store(token);
  remember(token);
  return token;
}

/* One document per token, named by the token, because that is what makes a
   second phone a second row instead of overwriting the first. A person with
   a phone and a desk machine has two; both should buzz. */
async function store(token) {
  const me = auth.currentUser();
  const { d, m } = await auth.db();
  await m.setDoc(m.doc(d, 'fcmTokens', token), {
    uid: me.uid,
    name: me.name || '',
    label: deviceLabel(),
    at: new Date().toISOString(),
  });
}

export function deviceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

/* ---------- switching it off ------------------------------------------ */

/* Deleting the row is what stops the sending, so it is done first and the
   browser-side token is revoked after. If the revoke fails the row is
   already gone, which is the right way round: a token nobody will send to
   is harmless, a row that outlives the person's decision is not. */
export async function disable() {
  const t = tokenOnFile();
  if (t) {
    try {
      const { d, m } = await auth.db();
      await m.deleteDoc(m.doc(d, 'fcmTokens', t));
    } catch (e) { /* it may already be gone */ }
  }
  forget();
  try {
    const { getMessaging, deleteToken } = await messagingMod();
    const { app } = await auth.firebase();
    await deleteToken(getMessaging(app));
  } catch (e) { /* the row is what matters */ }
}

/* ---------- what the screen shows ------------------------------------- */

export async function mine() {
  const me = auth.currentUser();
  if (!me || me.demo) return [];
  try {
    const { d, m } = await auth.db();
    const snap = await m.getDocs(m.query(m.collection(d, 'fcmTokens'),
      m.where('uid', '==', me.uid)));
    return snap.docs.map(x => ({ token: x.id, ...x.data() }));
  } catch (e) { return []; }
}

/* What this account will actually be sent, in the words of the thing that
   sends it. If the answer is "nothing", the screen says so rather than
   offering a switch that does nothing. */
export function willGet() {
  const out = [];
  if (auth.allow('push.down')) {
    out.push('A rig down waiting on parts');
  }
  if (auth.allow('push.wo')) {
    out.push('A work order rung in');
  }
  return out;
}
