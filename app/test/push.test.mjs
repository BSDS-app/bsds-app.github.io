/* The notification layer, checked without a browser or a network.
 *
 * Everything here is a cross-check between files that have to agree and
 * cannot be made to agree by a type system: the service worker carries a
 * second copy of the project config, the Cloud Function reads fields that
 * two other files write, and the audience the function sends to has to
 * match the capability matrix the app draws from. Each of those is a place
 * where a change in one file quietly breaks another, which is exactly the
 * kind of break nobody finds until a rig is down and no phone rings.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';
import { GRANTS, HARD_RULES } from '../roles.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const bad = [];
const ok = (c, what, extra) => {
  if (c) pass++; else { fail++; bad.push(what + (extra ? ' :: ' + extra : '')); }
};

const sw = read('sw.js');
const fn = read('functions/index.js');
const rules = read('firestore.rules');
const appjs = read('app.js');
const pushjs = read('push.js');
const parts = read('parts.js');
const wo = read('workorders.js');

/* ---- the key ---------------------------------------------------------- */
const key = (CONFIG.push || {}).vapidKey || '';
ok(key.length > 80, 'there is a web push key');
ok(/^B[A-Za-z0-9_-]+$/.test(key), 'and it looks like a VAPID public key', key.slice(0, 10));
ok(pushjs.includes('CONFIG.push.vapidKey'),
  'and the client passes it rather than hard-coding one');

/* ---- the worker carries a SECOND copy of the config -------------------
   It has to: a service worker is a classic worker and cannot import an ES
   module. A copy that drifts means a worker signing tokens for the wrong
   project, which fails in a way that looks like "notifications just do not
   work on my phone". So every value is compared. */
['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']
  .forEach(k => {
    const want = CONFIG.firebase[k];
    ok(sw.includes("'" + want + "'"),
      `sw.js carries the same ${k} as config.js`, want);
  });

/* ---- the worker's scope ----------------------------------------------- */
ok(/register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/.test(pushjs),
  'the worker is registered relative, so it claims /app/ and not the whole site');
ok(!/scope: '\/'/.test(pushjs),
  'and never the site root, where the old Launcher lives');

/* ---- data-only, so nothing buzzes twice ------------------------------- */
ok(/onBackgroundMessage/.test(sw), 'the worker draws the notification itself');
ok(/showNotification/.test(sw), 'and shows it');
ok(!/notification: \{/.test(fn),
  'the sender does NOT include a notification block, which would buzz twice');
ok(/data: \{/.test(fn), 'it sends the fields as data');

/* ---- exactly two things buzz -----------------------------------------
   Mike: "i want notifications on down things. just the others i want them
   just sitting for me." A third sender appearing here without him asking
   is the failure this guards. */
const senders = [...fn.matchAll(/exports\.(\w+) = onDocumentCreated/g)].map(m => m[1]);
ok(senders.length === 2, 'there are exactly two senders', senders.join(', '));
ok(senders.includes('rigdown') && senders.includes('workorder'),
  'and they are the rig-down and the work order', senders.join(', '));
ok(/r\.urgency !== 'down'/.test(fn),
  'the parts sender fires on DOWN and nothing else');
ok(!/preops|jsas|receipts/.test(fn),
  'nothing about pre-ops, JSAs or receipts is sent to a phone');

/* ---- who gets rung --------------------------------------------------- */
const rigAudience = (fn.match(/tokensForRoles\(\['owner'\]\)/) || [])[0];
ok(!!rigAudience, 'a rig down rings the owners only - Mike and Stew');
ok(/tokensForRoles\(\['owner', 'office'\]\)/.test(fn),
  'a work order rings the owners and the office');
ok(GRANTS.owner.includes('push.down') && GRANTS.owner.includes('push.wo'),
  'the matrix agrees: an owner is told about both');
ok(!GRANTS.office.includes('push.down') && GRANTS.office.includes('push.wo'),
  'office is told about work orders and not about rigs down');
ok(!GRANTS.tech.includes('push.down') && !GRANTS.tech.includes('push.wo'),
  'a tech is sent nothing, and is offered no switch');
['push.down', 'push.wo'].forEach(cap => {
  ok(HARD_RULES.some(r => r.cap === cap),
    `${cap} is pinned in HARD_RULES so it cannot drift`);
});

/* ---- the audience is READ, not copied --------------------------------
   The cheap version stamps the role on the token document. The day that
   copy goes stale is the day somebody changed jobs - which is the day it
   matters. */
ok(/collection\('users'\)[\s\S]{0,160}where\('role', 'in', roles\)/.test(fn),
  'the roles are read out of the users collection when the push is sent');
ok(/where\('active', '==', true\)/.test(fn),
  'and somebody switched off is not rung');
ok(!/role/.test(pushjs.split('async function store')[1].split('}')[0] || ''),
  'the token document does not carry a role to go stale');

/* ---- the function only reads fields that are actually written --------
   This is the bug class that bites silently: the sender reads r.name, the
   writer saves byName, and every notification arrives with half a line
   missing. Nothing in JavaScript catches that, so it is checked here. */
const written = new Set();
[parts, wo].forEach(src => {
  /* the record literal, from `rec: {` to the line that closes it */
  const rec = (src.split('rec: {')[1] || '').split('\n    },')[0];
  [...rec.matchAll(/(\w+):/g)].forEach(m => written.add(m[1]));
  /* shorthand properties - `urgency,` on its own line is a saved field too */
  [...rec.matchAll(/^\s*(\w+),\s*$/gm)].forEach(m => written.add(m[1]));
});
['uid', 'byName', 'unit', 'urgency', 'lines', 'customerName', 'complaint',
 'calledBy', 'location'].forEach(f => {
  ok(written.has(f), `the writers really do save ${f}`,
    [...written].join(','));
});
/* Only the two trigger handlers, and only the record variable in each -
   `r.error` inside the sender is a send result, not a stored field. */
['rigdown:r', 'workorder:w'].forEach(pair => {
  const [name, v] = pair.split(':');
  const body = (fn.split('exports.' + name)[1] || '').split('exports.')[0];
  const re = new RegExp('\\b' + v + '\\.(\\w+)', 'g');
  const seen = new Set([...body.matchAll(re)].map(m => m[1]));
  seen.forEach(f => {
    ok(written.has(f),
      `${name} reads ${f}, which the writer really saves`, [...written].join(','));
  });
  ok(seen.size > 0, `${name} reads something off the record`);
});

/* ---- a tap lands somewhere useful ------------------------------------ */
const gos = [...fn.matchAll(/go: '(\w+)'/g)].map(m => m[1]);
ok(gos.length >= 2, 'every push says where a tap should land', gos.join(', '));
const whitelist = (appjs.match(/const FROM_PUSH = \[([^\]]+)\]/) || [])[1] || '';
gos.forEach(g => {
  ok(whitelist.includes("'" + g + "'"),
    `the app will route a tap to ${g}`, whitelist);
});
const swDest = (sw.match(/const DEST = \{([\s\S]*?)\}/) || [])[1] || '';
gos.forEach(g => {
  ok(swDest.includes(g + ':'), `and the worker knows ${g}`, swDest.replace(/\s+/g, ' '));
});
ok(/FROM_PUSH\.indexOf\(where\) < 0/.test(appjs),
  'and anything not on that list is ignored rather than routed to');

/* ---- the token rows -------------------------------------------------- */
const tok = (rules.split('match /fcmTokens/{token}')[1] || '').split('}')[0];
ok(tok.length > 0, 'there is a rule block for the tokens');
ok(/request\.resource\.data\.uid == request\.auth\.uid/.test(tok),
  'a person registers only their own device', tok.replace(/\s+/g, ' '));
ok(/resource\.data\.uid == request\.auth\.uid/.test(tok),
  'and reads and clears only their own');
ok(!/isOwner\(\)|isOffice\(\)|staff\(\)/.test(tok),
  'nobody reads anybody else’s - a list of who carries what phone is not '
  + 'something this app needs to produce', tok.replace(/\s+/g, ' '));

/* ---- a dead phone does not pile up ----------------------------------- */
ok(/registration-token-not-registered/.test(fn),
  'the sender notices a token the push service has given up on');
ok(/fcmTokens'\)\.doc\(t\)\.delete\(\)/.test(fn),
  'and deletes that row, because nothing else can');

/* ---- a failed push must not undo the write --------------------------- */
['rigdown', 'workorder'].forEach(name => {
  const body = fn.split('exports.' + name)[1] || '';
  ok(/try \{/.test(body.slice(0, 400)) && /logger\.error/.test(body.slice(0, 2600)),
    `${name} swallows its own failure - the record is already saved`);
});

/* ---- the iPhone truth ------------------------------------------------ */
ok(/iosNeedsInstall/.test(pushjs) && /standalone/.test(pushjs),
  'the app detects an iPhone in a browser tab, where push cannot work');
ok(/Add to Home Screen/.test(appjs),
  'and says so in words instead of showing a button that cannot work');
ok(/matchMedia/.test(pushjs),
  'and detects it by display mode rather than by sniffing the user agent');

console.log(`\n${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  FAIL  ' + b));
process.exit(fail ? 1 : 0);
