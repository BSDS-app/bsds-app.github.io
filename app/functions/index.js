/* The sender.
 *
 * The app's home-screen band already works out what is waiting on somebody
 * the moment they open the app. This exists for the other case: when nobody
 * has opened it, and a rig is sitting in a pit not drilling.
 *
 * Mike's instruction, verbatim, is the whole specification: "i want
 * notifications on down things. just the others i want them just sitting
 * for me." So there are exactly two senders here and there should not be a
 * third without him asking for it. A notification that arrives most days
 * gets swiped away unread by the end of the week, and then the one that
 * mattered gets swiped away with it.
 *
 *   a parts request marked DOWN   ->  the owners. Mike and Stew, nobody else.
 *   a work order rung in          ->  the owners and the office.
 *
 * WHY THE AUDIENCE IS LOOKED UP EVERY TIME. It would be cheaper to stamp
 * the role onto the token document when the phone registers. It would also
 * be wrong: that is a copy, and the day it goes stale is the day somebody
 * changes jobs - exactly when you care who is being rung. So the roles are
 * read out of the users collection at the moment of sending, and a role
 * changed a minute ago is already in force.
 *
 * Nothing here is allowed to throw its way out. A push that fails must not
 * fail the write that triggered it: the request is saved, the band will
 * show it, and the worst case is the old behaviour of somebody having to
 * open the app. Losing the record would be a real problem; losing the buzz
 * is an inconvenience.
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

const REGION = 'us-central1';

/* ---------- who to ring ------------------------------------------------ */

async function tokensForRoles(roles) {
  const users = await db.collection('users')
    .where('role', 'in', roles)
    .where('active', '==', true)
    .get();
  const uids = users.docs.map(d => d.id);
  if (!uids.length) return [];

  /* `in` takes thirty at a time. Thirteen customers and five staff is not
     thirty, but a company that grows into it should not discover the limit
     by silently not being told a rig is down. */
  const out = [];
  for (let i = 0; i < uids.length; i += 30) {
    const snap = await db.collection('fcmTokens')
      .where('uid', 'in', uids.slice(i, i + 30))
      .get();
    snap.docs.forEach(d => out.push(d.id));
  }
  return out;
}

/* ---------- sending ---------------------------------------------------- */

async function send(tokens, { title, body, go, level, tag }) {
  if (!tokens.length) {
    logger.info('nothing to send to', { title });
    return;
  }
  /* Data-only. A `notification` block would be drawn by the browser itself
     and, on some platforms, by the service worker as well - two buzzes for
     one event. The worker draws it; see sw.js. */
  const message = {
    data: {
      title: String(title || 'Broken Spoke'),
      body: String(body || ''),
      go: String(go || ''),
      level: String(level || 'note'),
      tag: String(tag || ''),
    },
    webpush: {
      headers: { Urgency: level === 'stop' ? 'high' : 'normal' },
      fcmOptions: { link: 'https://bsds-app.github.io/app/' + (go ? '?go=' + go : '') },
    },
    tokens,
  };

  const res = await getMessaging().sendEachForMulticast(message);
  logger.info('sent', { ok: res.successCount, failed: res.failureCount });

  /* WHY a send failed, not just that it did. Written after a deploy where
     the count said 0 sent and 1 failed and there was nothing in the logs
     to say what had gone wrong. If it fails, say so in words. */
  res.responses.forEach((r) => {
    if (!r.error) return;
    logger.error('push rejected', {
      code: r.error.code || '(none)',
      detail: String(r.error.message || '').slice(0, 300),
    });
  });

  /* A phone that has been wiped, reinstalled or signed out leaves a token
     behind that will never work again. Pruning it here is the only place
     that can: the client cannot know, and nobody is going to go looking. */
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token'
        || code === 'messaging/invalid-argument') {
      dead.push(tokens[i]);
    }
  });
  if (dead.length) {
    logger.info('pruning dead tokens', { n: dead.length });
    await Promise.all(dead.map(t =>
      db.collection('fcmTokens').doc(t).delete().catch(() => {})));
  }
}

const trim = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/* ---------- a rig is down --------------------------------------------- */

exports.rigdown = onDocumentCreated(
  { document: 'partsRequests/{id}', region: REGION },
  async (event) => {
    try {
      const r = event.data && event.data.data();
      if (!r) return;
      if (r.urgency !== 'down') return;          /* the only thing that buzzes */

      const lines = Array.isArray(r.lines) ? r.lines : [];
      const what = lines.slice(0, 2)
        .map(l => (l.qty ? l.qty + '× ' : '') + (l.desc || l.pn || 'a part'))
        .join(', ');
      const more = lines.length > 2 ? ' +' + (lines.length - 2) + ' more' : '';

      await send(await tokensForRoles(['owner']), {
        title: 'Rig down — ' + (r.unit || 'unit not given'),
        body: trim((r.byName ? r.byName + ': ' : '') + what + more, 140)
          || 'A rig is down waiting on parts.',
        go: 'partsq',
        level: 'stop',
        tag: 'down-' + (r.unit || event.params.id),
      });
    } catch (e) {
      /* The request is already saved. This failing must not undo it. */
      logger.error('rigdown failed', e);
    }
  });

/* ---------- a work order came in --------------------------------------- */

exports.workorder = onDocumentCreated(
  { document: 'workOrders/{id}', region: REGION },
  async (event) => {
    try {
      const w = event.data && event.data.data();
      if (!w) return;

      await send(await tokensForRoles(['owner', 'office']), {
        title: 'Work order — ' + (w.customerName || 'customer not given'),
        body: trim([w.unit, w.location, w.complaint,
          w.calledBy && 'called by ' + w.calledBy]
          .filter(Boolean).join(' · '), 160)
          || 'A work order has been rung in.',
        go: 'wolist',
        level: 'soon',
        tag: 'wo-' + event.params.id,
      });
    } catch (e) {
      logger.error('workorder failed', e);
    }
  });
