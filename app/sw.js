/* The service worker. Its whole job is to be awake when the app is not.
 *
 * SCOPE MATTERS. This file sits in /app/ and is registered with scope
 * /app/, so it governs the new app and nothing else. The old Launcher at
 * the site root keeps working exactly as it does today, untouched - which
 * is the standing rule for everything built here.
 *
 * WHY THE CONFIG IS COPIED IN HERE. A service worker is a classic worker,
 * not a module, so it cannot import config.js. The project identifiers are
 * therefore written out again below. That is a duplicate, and duplicates
 * drift - so test/push.test.mjs reads both files and fails if they ever
 * disagree. Do not edit one without the other.
 *
 * Messages arrive DATA-ONLY on purpose. If a push carries a `notification`
 * block the browser draws it itself, and on some platforms the handler
 * below fires as well - two buzzes for one event. Sending the fields as
 * data and drawing the notification here means one buzz everywhere, and the
 * wording is ours rather than the platform's.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDGCSVhunOex6nncT0tQ_EsfCL8mu8GUzU',
  authDomain: 'bsds-app.firebaseapp.com',
  projectId: 'bsds-app',
  storageBucket: 'bsds-app.firebasestorage.app',
  messagingSenderId: '507015047525',
  appId: '1:507015047525:web:29c7fd93aa2e3278a3198c',
});

const messaging = firebase.messaging();

/* Where a tap should land. A notification that dumps you on the home
   screen makes you go and find the thing it just told you about. */
const DEST = {
  partsq:  'partsq',
  wolist:  'wolist',
  preoplog: 'preoplog',
};

messaging.onBackgroundMessage((payload) => {
  const d = (payload && payload.data) || {};
  const title = d.title || 'Broken Spoke';
  const go = DEST[d.go] || '';
  self.registration.showNotification(title, {
    body: d.body || '',
    icon: '../icon-192.png',
    badge: '../icon-192.png',
    tag: d.tag || undefined,     /* one per subject, so a re-send replaces */
    renotify: !!d.tag,
    requireInteraction: d.level === 'stop',
    data: { go, at: Date.now() },
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const go = (e.notification.data && e.notification.data.go) || '';
  const url = new URL('./', self.location.href).href + (go ? '?go=' + go : '');
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* If the app is already open, use that window rather than stacking up
       another copy of it - and tell it where to go. */
    for (const c of open) {
      if (c.url.indexOf(new URL('./', self.location.href).href) === 0) {
        await c.focus();
        if (go) c.postMessage({ bsds: 'go', go });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
