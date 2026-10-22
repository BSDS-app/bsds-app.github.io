/* The shell: who is signed in, what they may see, and where they can get to.
 *
 * Every screen is drawn from the same two questions - allow(cap) and the
 * route - so adding a tool is one entry in config.js and one capability in
 * roles.js, not a new wing of the building.
 */
import { CONFIG, DEMO } from './config.js';
import { ROLES, CAPS, GRANTS, HARD_RULES, can } from './roles.js';
import * as auth from './auth.js';
import * as preop from './preop.js';
import * as jsa from './jsa.js';
import * as team from './people.js';
import * as push from './push.js';
import * as receipt from './receipts.js';
import * as book from './books.js';
import * as fleet from './fleet.js';
import * as parts from './parts.js';
import * as alerts from './alerts.js';
import * as wo from './workorders.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let DATA = { customers: [], equipment: [] };
let route = { view: 'home', arg: null };
let signupMode = false;
/* requests ticked on the parts queue, carried to the order form */
let PICKED = [];
const stack = [];

/* ---------- data ------------------------------------------------------ */
async function loadData() {
  if (DEMO) {
    const [c, e] = await Promise.all([
      fetch('seed/customers.json').then(r => r.json()),
      fetch('seed/equipment.json').then(r => r.json()),
    ]);
    DATA = fleet.nameFleet(fleet.overlay({ customers: c, equipment: e }));
    return;
  }
  const { d, m } = await auth.db();
  const [cs, es] = await Promise.all([
    m.getDocs(m.collection(d, 'customers')),
    m.getDocs(m.collection(d, 'equipment')),
  ]);
  DATA = fleet.nameFleet({
    customers: cs.docs.map(x => ({ id: x.id, ...x.data() })),
    equipment: es.docs.map(x => ({ id: x.id, ...x.data() })),
  });
}

/* A tool on our own site can be shown inside the app, with the app's bar and
   its Back button still above it. Anything else - Fullbay, a parts book on
   claude.ai - is somebody else's site and has to open in its own tab. */
const OURS = 'https://bsds-app.github.io/';
const inApp = url => typeof url === 'string' && url.indexOf(OURS) === 0;

const machinesOf = cid => DATA.equipment.filter(e => e.customer === cid);
/* One matcher for book-to-serial, in fleet.js, so the fleet screen and the
   machine screen cannot disagree about which book a rig takes. */
const bookFor = fleet.bookFor;

/* ---------- navigation ------------------------------------------------ */
/* `replace` drops the screen you are leaving instead of stacking it. Used
   when a form has just been filed: Back should take you where you were
   before you started filling it in, not back into the blank form you have
   already submitted. */
function go(view, arg, replace) {
  if (!replace) stack.push({ ...route, scroll: window.scrollY });
  route = { view, arg };
  draw();
  window.scrollTo(0, 0);
}
function back() {
  const p = stack.pop();
  route = p ? { view: p.view, arg: p.arg } : { view: 'home', arg: null };
  draw();
  window.scrollTo(0, p ? (p.scroll || 0) : 0);
}

/* ---------- chrome ---------------------------------------------------- */
/* Every tile is drawn through this, so the icon column and the text column
   cannot get out of step between one screen and another. */
const tileFace = (title, sub, ic, extra) =>
  icon(ic || 'grid') + '<span class="tx"><b>' + esc(title) + '</b>'
  + '<span>' + esc(sub || '') + '</span>' + (extra || '') + '</span>';

function chrome(title, sub) {
  const u = auth.currentUser();
  $('ttl').innerHTML = esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '');
  /* the roundel sits where Back would be, so they never fight for the
     narrow end of a phone bar */
  const mark = $('topmark');
  if (mark) mark.hidden = stack.length > 0;
  $('back').hidden = stack.length === 0;
  $('who').hidden = !u;
  if (u) {
    $('rolepill').textContent = ROLES[u.role] ? ROLES[u.role].label : 'No access';
    $('rolepill').title = u.name + ' · ' + (u.email || '');
  }
}

/* ---------- screens --------------------------------------------------- */
function signIn() {
  chrome('Broken Spoke', 'Sign in');
  $('back').hidden = true;
  $('who').hidden = true;
  const h = [];
  h.push('<div class="signin"><div class="mark">',
    '<img src="../icon-192.png" alt="">',
    '<b>Broken Spoke</b><span>Drilling Solutions</span></div>');

  if (DEMO) {
    h.push('<div class="panel"><label>Open the app as</label>',
      '<div class="people">');
    auth.demoPeople().forEach(p => {
      h.push('<button data-demo="', p.uid, '"><span class="nm">', esc(p.name),
        '</span><span class="rl">', esc(ROLES[p.role].label), '</span></button>');
    });
    h.push('</div><p class="tiny">Preview. No accounts, no data written. ',
      'Pick a person to see exactly what they get.</p></div>');
  } else if (signupMode) {
    /* Setting a password is not the same as being let in. The invitation an
       owner wrote is what admits you; this only creates the sign-in. Said
       plainly here so nobody thinks they have been locked out by mistake. */
    h.push('<div class="panel">',
      '<div class="note">Use the email address Mike or Stew invited. Setting a ',
      'password here creates your sign-in — what lets you into the app is the ',
      'invitation against that address.</div>',
      '<label for="email">Your email</label>',
      '<input id="email" type="email" autocomplete="username" inputmode="email">',
      '<label for="pw">Choose a password</label>',
      '<input id="pw" type="password" autocomplete="new-password">',
      '<button class="btn primary" id="makeacct">Create my sign-in</button>',
      '<button class="btn ghost" id="backtosignin">Back to sign in</button>',
      '<p class="msg" id="msg"></p></div>');
  } else {
    h.push('<div class="panel">',
      '<button class="btn primary" id="google">Sign in with Broken Spoke Google</button>',
      '<div class="or">or, for techs</div>',
      '<label for="email">Email</label>',
      '<input id="email" type="email" autocomplete="username" inputmode="email">',
      '<label for="pw">Password</label>',
      '<input id="pw" type="password" autocomplete="current-password">',
      '<button class="btn primary" id="pwgo">Sign in</button>',
      '<button class="btn ghost" id="reset">Email me a reset link</button>',
      '<button class="btn ghost" id="firsttime">First time here</button>',
      '<p class="msg" id="msg"></p></div>');
  }
  h.push('</div>');
  $('view').innerHTML = h.join('');
}

function pending() {
  const u = auth.currentUser();
  chrome('Broken Spoke', 'Not admitted yet');
  $('view').innerHTML = '<div class="wrap"><h1 class="pg">Hold on</h1>'
    + '<p class="lede">You are signed in as <b>' + esc(u.email) + '</b>, but nobody '
    + 'has given this account a role yet. Mike or Stew can switch it on from '
    + 'People; until then there is nothing to show you.</p></div>';
}

function home() {
  const u = auth.currentUser();
  chrome('Broken Spoke', 'Drilling Solutions · ' + String(u.name || '').split(' ')[0]);
  /* The band is filled in after the page draws rather than before it, so a
     slow read never leaves somebody looking at a blank screen. */
  const h = ['<div class="wrap"><div id="alerts"></div>'];

  const tiles = [];
  const face = (t, extra) => tileFace(t.title, t.blurb, t.icon, extra);
  for (const [key, t] of Object.entries(CONFIG.tools)) {
    if (!auth.allow(t.cap)) continue;
    const tone = ' ' + (t.tone || 'blue');
    /* A tool built into the app is a route, not an address: no iframe, no
       second site, Back works like it does everywhere else. */
    if (t.route) {
      tiles.push('<button class="tile' + tone + '" data-go="' + esc(t.route) + '">'
        + face(t) + '</button>');
    } else if (!t.url) {
      tiles.push('<div class="tile off' + tone + '">'
        + face(t, '<em>No address configured yet</em>') + '</div>');
    } else if (inApp(t.url)) {
      tiles.push('<button class="tile' + tone + '" data-tool="' + esc(key) + '">'
        + face(t) + '</button>');
    } else {
      tiles.push('<a class="tile out' + tone + '" href="' + esc(t.url) + '" '
        + 'target="_blank" rel="noopener">'
        + face(t, '<em class="leaves">Opens in a new tab</em>') + '</a>');
    }
  }
  if (tiles.length) {
    h.push('<h2 class="sec">Tools</h2><div class="tiles">', tiles.join(''), '</div>');
  }

  /* While the old Launcher is still up, everyone gets a door back to it. */
  if (CONFIG.legacy && CONFIG.legacy.url) {
    h.push('<h2 class="sec">Still running</h2><div class="tiles">',
      '<button class="tile muted" data-tool="__legacy">',
      face(CONFIG.legacy), '</button></div>');
  }

  const nav = [];
  if (auth.allow('equipment.view')) {
    nav.push(['equipment', 'Machines',
      DATA.equipment.length + ' rigs across ' + DATA.customers.length + ' customers']);
  }
  if (auth.allow('books.view')) {
    nav.push(['books', 'Parts books', 'Books, schematics and manuals']);
  }
  if (auth.allow('preop.log')) {
    nav.push(['logs', 'Logs', 'Pre-op, JSA, receipts']);
  } else if (auth.allow('preop.submit')) {
    /* A tech gets his own paperwork back and nobody else's. Not a cut-down
       version of the master log - a different query, which the database
       enforces whatever these lines say. */
    nav.push(['preoplog', 'My inspections', 'The pre-ops you have filed']);
    if (auth.allow('jsa.own')) {
      nav.push(['jsalog', 'My JSAs', 'The JSAs you have filed']);
    }
  }
  if (auth.allow('parts.order')) {
    nav.push(['partsq', 'Parts', 'What the field is waiting on']);
  } else if (auth.allow('parts.request')) {
    nav.push(['partsmine', 'My parts requests', 'What you have asked for']);
  }
  if (auth.allow('wo.manage')) {
    nav.push(['wolist', 'Work orders', 'Called in, waiting to be built']);
  } else if (auth.allow('wo.request')) {
    nav.push(['wolist', 'My work orders', 'What you have rung in']);
  }
  if (auth.allow('receipts.log')) {
    nav.push(['receiptq', 'Receipts', 'Sent in, waiting to be entered']);
  }
  if (auth.allow('users.manage')) {
    nav.push(['people', 'People', 'Who can see what']);
  }
  /* Only offered to somebody the sender will actually send to. A switch
     that turns on nothing is worse than no switch. */
  if (push.willGet().length) {
    nav.push(['notify', 'Notifications', pushSub()]);
  }
  nav.push(['perms', 'What my role can see', ROLES[u.role].note]);

  h.push('<h2 class="sec">In the app</h2><div class="list">');
  nav.forEach(([v, nm, sub]) => {
    h.push('<button class="row" data-go="', v, '"><span><span class="nm">', esc(nm),
      '</span><span class="sub">', esc(sub), '</span></span>',
      '<span class="ct">›</span></button>');
  });
  h.push('</div>');

  if (u.role === 'tech') {
    h.push('<div class="note"><b>What you will not find here.</b> The master logs, ',
      'receipt images and other people’s JSAs are not on your account. ',
      'What you send in still arrives — you just cannot read the pile back.</div>');
  }
  h.push('</div>');
  $('view').innerHTML = h.join('');
  paintAlerts();
}

/* Drawn separately and allowed to fail quietly: if the band cannot load,
   the app is still the app. */
async function paintAlerts() {
  const box = $('alerts');
  if (!box) return;
  try {
    const items = await alerts.gather(DATA);
    if ($('alerts') === box) alerts.draw(box, items);
  } catch (e) { /* no band rather than a broken screen */ }
}

function equipment() {
  const live = DATA.equipment.filter(e => !e.retired);
  chrome('Machines', live.length + ' rigs');
  const noSerial = fleet.needSerial(DATA.equipment);
  const h = ['<div class="wrap"><h1 class="pg">Machines</h1>',
    '<p class="lede">Pick a customer, then a rig, and the app gathers what it has ',
    'on that serial.</p>'];
  if (auth.allow('equipment.edit') || auth.allow('customers.edit')) {
    h.push('<div class="bar">');
    if (auth.allow('equipment.edit')) {
      h.push('<button class="mini" data-go="editrig">+ Add a machine</button>');
    }
    if (auth.allow('customers.edit')) {
      h.push('<button class="mini" data-go="editcust">+ Add a customer</button>');
    }
    h.push('</div>');
  }
  /* The blank serials are not a tidy-up job - each one is a rig whose parts
     book cannot be matched until somebody reads the plate. So they are a
     worklist on the front of this screen rather than something you would
     only notice by scrolling. */
  if (noSerial.length) {
    h.push('<div class="note warn"><b>', noSerial.length, ' machine',
      noSerial.length === 1 ? '' : 's', ' with no serial on file.</b> ',
      'The parts books are laid out by serial, so these cannot be matched to a book ',
      'until the plate is read. ',
      '<button class="mini" id="shownoserial">Show them</button></div>');
  }
  h.push('<div class="find"><input id="q" type="search" placeholder="Customer, unit, serial or model" ',
    'autocomplete="off" spellcheck="false"></div><div id="hits"></div></div>');
  $('view').innerHTML = h.join('');
  drawHits('');
  $('q').addEventListener('input', e => drawHits(e.target.value));
  const sn = $('shownoserial');
  if (sn) {
    sn.addEventListener('click', () => {
      $('hits').innerHTML = '<div class="list">'
        + fleet.needSerial(DATA.equipment).map(e => machineRow(e, true)).join('')
        + '</div>';
    });
  }
}

function drawHits(term) {
  const t = term.trim().toUpperCase();
  const h = [];
  if (!t) {
    h.push('<div class="list">');
    DATA.customers.forEach(c => {
      const n = machinesOf(c.id).filter(e => !e.retired).length;
      h.push('<button class="row" data-cust="', esc(c.id), '">',
        '<span class="nm">', esc(c.name), '</span>',
        '<span class="ct"><b>', n, '</b>rig', n === 1 ? '' : 's', '</span></button>');
    });
    h.push('</div>');
  } else {
    const hits = DATA.equipment.filter(e =>
      [e.customerName, e.unit, e.serial, e.model, e.nickname]
        .join(' ').toUpperCase().includes(t));
    hits.sort((a, b) => (a.retired ? 1 : 0) - (b.retired ? 1 : 0));
    if (!hits.length) {
      h.push('<div class="empty">Nothing matches “', esc(term), '”.</div>');
    } else {
      h.push('<div class="list">');
      hits.slice(0, 80).forEach(e => h.push(machineRow(e, true)));
      h.push('</div>');
    }
  }
  $('hits').innerHTML = h.join('');
}

function machineRow(e, withCustomer) {
  return '<button class="row' + (e.retired ? ' retired' : '') + '" data-rig="' + esc(e.id) + '">'
    + '<span><span class="nm">' + esc(e.unit)
    + (e.nickname ? ' · ' + esc(e.nickname) : '') + '</span>'
    + '<span class="sub">' + (withCustomer ? esc(e.customerName) + ' · ' : '')
    + (e.model ? esc(e.model) : 'model not on the export') + '</span></span>'
    + '<span class="ct">' + (e.serial ? '<b>' + esc(e.serial) + '</b>' : '<b>—</b>')
    + (bookFor(e.serial) ? 'book' : '') + '</span></button>';
}

function customer(cid) {
  const c = DATA.customers.find(x => x.id === cid);
  const ms = machinesOf(cid);
  chrome(c ? c.name : 'Customer', ms.length + ' rigs');
  const live = ms.filter(e => !e.retired);
  const gone = ms.filter(e => e.retired);
  const h = ['<div class="wrap"><h1 class="pg">', esc(c ? c.name : cid), '</h1>',
    '<p class="lede">', live.length, ' machine', live.length === 1 ? '' : 's',
    ' on file.</p>'];
  if (auth.allow('customers.edit') || auth.allow('equipment.edit')) {
    h.push('<div class="bar">');
    if (auth.allow('customers.edit')) {
      h.push('<button class="mini" data-editcust="', esc(cid), '">Edit customer</button>');
    }
    if (auth.allow('equipment.edit')) {
      h.push('<button class="mini" data-newrigfor="', esc(cid), '">+ Add a machine</button>');
    }
    h.push('</div>');
  }
  h.push('<div class="list">', live.map(e => machineRow(e, false)).join(''), '</div>');
  if (gone.length) {
    h.push('<h2 class="sec">Retired</h2><div class="list">',
      gone.map(e => machineRow(e, false)).join(''), '</div>');
  }
  h.push('</div>');
  $('view').innerHTML = h.join('');
}

function machine(id) {
  const e = DATA.equipment.find(x => x.id === id);
  if (!e) { $('view').innerHTML = '<div class="wrap"><div class="empty">No such machine.</div></div>'; return; }
  chrome(e.unit, e.customerName);
  const bk = bookFor(e.serial);
  const h = ['<div class="wrap">',
    '<h1 class="pg">', esc(e.unit), e.nickname ? ' · ' + esc(e.nickname) : '', '</h1>',
    '<p class="lede">', esc(e.customerName), '</p>'];
  if (e.retired) {
    h.push('<div class="note warn"><b>Retired.</b> Off the working fleet. Its ',
      'paperwork is still on file and still names it.</div>');
  }
  if (auth.allow('equipment.edit')) {
    h.push('<div class="bar"><button class="mini" data-editrig="', esc(e.id), '">',
      'Edit this machine</button></div>');
  }
  h.push(
    '<div class="spec">',
    cell('Serial', e.serial), cell('Make', e.make), cell('Model', e.modelOnly || e.model),
    cell('Year', e.year), cell('Meter', e.meter == null ? '' : e.meter.toLocaleString()),
    '</div>');

  h.push('<h2 class="sec">Documentation</h2>');
  if (bk) {
    h.push('<div class="tiles"><a class="tile blue" href="', esc(bk.url),
      '" target="_blank" rel="noopener">',
      tileFace('Parts book', bk.title, 'book',
        '<em class="leaves">Opens in a new tab</em>'), '</a></div>');
  } else {
    h.push('<div class="note"><b>No parts book built for this serial yet.</b> ',
      e.serial ? 'The original is in the parts-book library; it has not been converted.'
               : 'There is no serial on the Fullbay record, and the books are laid out '
                 + 'by serial — so this one cannot be matched until the plate is read.',
      '</div>');
  }
  h.push('</div>');
  $('view').innerHTML = h.join('');
}

function cell(label, v) {
  const empty = v === '' || v == null;
  return '<div' + (empty ? ' class="missing"' : '') + '><b>'
    + (empty ? 'not on file' : esc(v)) + '</b><span>' + esc(label) + '</span></div>';
}

/* ---------- parts books ------------------------------------------------ */
/* A book belongs to a serial. The coverage screen is the honest answer to
   "which of our machines can we actually look up" - and it is blunt about
   the ones that cannot, because the alternative is somebody guessing. */
let bookPicks = {};

async function bookCoverage() {
  chrome('Parts books', 'By machine');
  $('view').innerHTML = loading;
  try {
    await book.load();
    bookPicks = await book.picks();
    book.drawCoverage($('view'), book.coverage(bookPicks), {});
  } catch (e) { $('view').innerHTML = oops(e, 'read the book index'); }
}

async function machineBook(machineId) {
  chrome('Parts book', 'For this machine');
  $('view').innerHTML = loading;
  try {
    await book.load();
    if (!Object.keys(bookPicks).length) bookPicks = await book.picks();
    const view = book.forMachine(machineId, bookPicks);
    book.drawForMachine($('view'), view, { canChoose: auth.allow('equipment.edit') });
  } catch (e) { $('view').innerHTML = oops(e, 'open it'); }
}

function books() {
  chrome('Parts books', 'Library');
  const h = ['<div class="wrap"><h1 class="pg">Parts books</h1>',
    '<p class="lede">What has been converted so far. Each one opens in its own tab; ',
    'they move inside the app once storage is switched on.</p>',
    '<h2 class="sec">By machine</h2><div class="tiles">'];
  CONFIG.books.forEach(b => h.push('<a class="tile blue" href="', esc(b.url),
    '" target="_blank" rel="noopener">',
    tileFace(b.title, b.serial ? 's/n ' + b.serial : 'no serial', 'book'), '</a>'));
  h.push('</div><h2 class="sec">Every machine</h2><div class="list">',
    '<button class="row" data-go="bookcover"><span><span class="nm">Which rigs have a book'
    + '</span><span class="sub">Matched by serial, chosen by judgement, or nothing yet'
    + '</span></span><span class="ct">\u203a</span></button></div>',
    '<h2 class="sec">Schematics and manuals</h2><div class="tiles">');
  CONFIG.shelves.forEach(s => h.push('<a class="tile teal" href="', esc(s.url),
    '" target="_blank" rel="noopener">',
    tileFace(s.title, 'Reference', 'book'), '</a>'));
  h.push('</div></div>');
  $('view').innerHTML = h.join('');
}

/* A tool, shown inside the app. The bar above it stays, so Back goes back to
   where you were instead of leaving you stranded in another tab. */
function tool(key) {
  const t = key === '__legacy' ? CONFIG.legacy : CONFIG.tools[key];
  if (!t || !t.url) { $('view').innerHTML =
    '<div class="wrap"><div class="empty">That tool has no address yet.</div></div>'; return; }
  chrome(t.title, t.blurb);
  document.body.classList.add('framed');
  $('view').innerHTML = '<div class="frame"><iframe src="' + esc(t.url)
    + '" title="' + esc(t.title) + '" '
    + 'allow="camera; clipboard-write" referrerpolicy="same-origin"></iframe></div>';
  sitFrameUnderBar();
}

/* The bar is not always the same height - the preview banner sits above it,
   and a phone adds its own inset - so the frame is placed under wherever the
   bar actually ends rather than under where it is assumed to end. */
function sitFrameUnderBar() {
  const f = document.querySelector('.frame');
  if (!f) return;
  f.style.top = Math.max(0, document.querySelector('.top').getBoundingClientRect().bottom) + 'px';
}
window.addEventListener('resize', sitFrameUnderBar);
window.addEventListener('orientationchange', sitFrameUnderBar);

function logs() {
  chrome('Logs', 'Pre-op, JSA, receipts');
  const h = ['<div class="wrap"><h1 class="pg">Logs</h1>',
    '<p class="lede">Pre-op is in the app now and reads back as the sheet it was '
    + 'signed on. The others are still in their spreadsheets behind the Apps Script '
    + 'backends.</p><div class="list">'];
  h.push('<button class="row" data-go="preoplog"><span><span class="nm">Pre-op inspections',
    '</span><span class="sub">In the app · kept ', esc(CONFIG.retention.preop.label),
    '</span></span><span class="ct">›</span></button>');
  h.push('<button class="row" data-go="jsalog"><span><span class="nm">JSAs',
    '</span><span class="sub">In the app · kept ', esc(CONFIG.retention.jsa.label),
    '</span></span><span class="ct">›</span></button>');
  h.push('</div>');
  h.push('<h2 class="sec">Staying where they are</h2><div class="note">',
    '<b>Receipts.</b> The photo lands in the Drive folder and Jazmine works out of ',
    'the accounting folder. That is deliberate — it is not broken, and moving it ',
    'would break it.</div>');
  h.push('</div>');
  $('view').innerHTML = h.join('');
}

/* ---------- pre-op --------------------------------------------------- */
/* Drawn async because the form template is a file, not a literal in the
   bundle. If it cannot be loaded the screen says so instead of drawing half
   a checklist - a pre-op missing lines is worse than no pre-op. */
let TPL = null;

async function preopForm() {
  chrome('Pre-Op Inspection', 'New sheet');
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading the checklist…</div></div>';
  try { TPL = await preop.template(); }
  catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>The checklist '
      + 'did not load.</b> Nothing is wrong with your sheet — the form itself is '
      + 'missing, so the app will not draw a partial one. ' + esc(e.message)
      + '</div></div>';
    return;
  }
  preop.drawForm($('view'), TPL, { equipment: DATA.equipment });
}

async function preopLog() {
  const mine = !auth.allow('preop.log');
  chrome('Pre-op inspections', mine ? 'Yours' : 'Master log');
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading…</div></div>';
  try {
    const rows = await preop.list({});
    preop.drawLog($('view'), rows, { mine });
  } catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Could not read '
      + 'the log.</b> ' + esc(e.message) + '</div></div>';
  }
}

/* ---------- JSA ------------------------------------------------------ */
let JTPL = null;

async function jsaForm() {
  chrome('Job Safety Analysis', 'New JSA');
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading the form…</div></div>';
  try { JTPL = await jsa.template(); }
  catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>The JSA form '
      + 'did not load.</b> Nothing is wrong with your work — the form itself is '
      + 'missing, and a half-drawn JSA is worse than none. ' + esc(e.message)
      + '</div></div>';
    return;
  }
  jsa.drawForm($('view'), JTPL, { equipment: DATA.equipment });
}

async function jsaLog() {
  const mine = !auth.allow('jsa.log');
  chrome('JSAs', mine ? 'Yours' : 'Master log');
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading…</div></div>';
  try {
    jsa.drawLog($('view'), await jsa.list({}), { mine });
  } catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Could not read '
      + 'the log.</b> ' + esc(e.message) + '</div></div>';
  }
}

async function jsaRecord(id) {
  chrome('JSA', 'As signed');
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading…</div></div>';
  try {
    const rec = await jsa.get(id);
    if (!rec) {
      $('view').innerHTML = '<div class="wrap"><div class="empty">No such JSA. '
        + 'It may have passed its retention date.</div></div>';
      return;
    }
    jsa.drawRecord($('view'), rec, { canHold: auth.allow('jsa.hold') });
  } catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Could not open '
      + 'it.</b> ' + esc(e.message) + '</div></div>';
  }
}

/* ---------- notifications ---------------------------------------------- */
/* The band in alerts.js tells you what is waiting WHEN YOU OPEN THE APP.
   This is the half that reaches you when you have not. Two events only -
   a rig down, and a work order rung in - because Mike said the rest should
   sit and wait for him, and a notification that fires every day is one
   nobody reads by Friday. */
function pushSub() {
  if (!push.supported()) return 'This browser cannot do them';
  if (push.iosNeedsInstall()) return 'Needs the app on your home screen first';
  const p = push.permission();
  if (p === 'granted') return push.tokenOnFile() ? 'On, on this device' : 'Allowed — not on yet';
  if (p === 'denied') return 'Blocked in your phone settings';
  return 'Off — a rig down would wait for you to look';
}

async function notify() {
  chrome('Notifications', 'What reaches your phone');
  const gets = push.willGet();
  const h = ['<div class="wrap">'];

  h.push('<div class="panel"><h2 class="sec">What gets sent</h2><ul class="plain">');
  gets.forEach(g => h.push('<li>', esc(g), '</li>'));
  h.push('</ul><p class="hint">Everything else — parts to order, defects to ',
    'sign off, a service order number coming back — stays on your home ',
    'screen and waits for you. That was deliberate.</p></div>');

  if (!push.supported()) {
    h.push('<div class="note warn"><b>This browser cannot do notifications.</b> ',
      'Nothing here will work until you open the app in a newer one.</div>');
  } else if (push.iosNeedsInstall()) {
    h.push('<div class="note warn"><b>Add the app to your home screen first.</b> ',
      'On an iPhone, notifications only reach an app that has been installed ',
      '— in Safari, tap Share, then <b>Add to Home Screen</b>, then open it ',
      'from there and come back here. In a browser tab there is nothing to ',
      'turn on. That is Apple\u2019s rule, not ours, and there is no way round it.',
      '</div>');
  } else if (push.permission() === 'denied') {
    h.push('<div class="note warn"><b>Your phone is blocking them.</b> ',
      'That switch is in the phone\u2019s own settings for this app, not in ',
      'here — nothing on this screen can change it back.</div>');
  } else {
    const on = push.permission() === 'granted' && !!push.tokenOnFile();
    h.push('<div class="panel">',
      on
        ? '<p class="msg good">On for this device.</p>'
        : '<p class="hint">Turning this on asks the phone for permission, then '
          + 'registers this one device. Doing it on your phone does not do it '
          + 'on your laptop — each one is its own switch.</p>',
      '<p class="msg" id="pmsg"></p>',
      on
        ? '<button type="button" class="mini" id="poff">Turn them off on this device</button>'
        : '<button type="button" class="btn primary" id="pon">Turn them on</button>',
      '</div>');
  }

  h.push('<div id="pdev"></div></div>');
  $('view').innerHTML = h.join('');

  /* Which devices are already on, so somebody can see that the old phone
     in a drawer is still being rung and switch it off. */
  const devs = await push.mine();
  if (devs.length) {
    const rows = devs.map(d => '<div class="row flat"><span><span class="nm">'
      + esc(d.label || 'A device') + '</span><span class="sub">added '
      + esc(String(d.at || '').slice(0, 10)) + '</span></span></div>').join('');
    $('pdev').innerHTML = '<h2 class="sec">Devices being rung</h2><div class="list">'
      + rows + '</div>';
  }
}

/* ---------- receipts ---------------------------------------------------- */
/* The photo path is unchanged - it still goes to the Apps Script backend
   that writes it to Drive and reads it with Claude. What is new is that
   the service order is picked rather than typed, and that one receipt can
   be split across more than one of them. */

let rctx = { picks: [], driveFileUrl: '', driveFileId: '' };

async function receiptPicks() {
  let was = [];
  try { was = await wo.list(); } catch (e) { /* standing buckets alone is fine */ }
  return receipt.pickList(was);
}

async function receiptForm() {
  chrome('Receipt', 'Send one in');
  if (!auth.allow('receipts.submit')) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Not your '
      + 'account to use.</b></div></div>';
    return;
  }
  $('view').innerHTML = loading;
  rctx = { picks: await receiptPicks(), driveFileUrl: '', driveFileId: '' };
  receipt.drawForm($('view'), rctx);
  resetLines();
}

/* The first line carries the whole amount, because one job is what usually
   happens. Splitting is a deliberate extra act, not the default. */
function resetLines() {
  const host = $('rlines');
  if (!host) return;
  host.innerHTML = receipt.lineRow(0, '', '');
  syncLines();
}

function syncLines() {
  const amt = ($('r_amount') || {}).value || '';
  const rows = [...document.querySelectorAll('[data-line]')];
  if (rows.length === 1) {
    const only = rows[0].querySelector('[data-l="amount"]');
    if (only && !only.value) only.value = String(amt).replace(/[$,\s]/g, '');
  }
  const left = $('rleft');
  if (!left) return;
  const total = receipt.cents(amt);
  const sum = rows.reduce((a, r) => {
    const c = receipt.cents((r.querySelector('[data-l="amount"]') || {}).value || '0');
    return a + (isFinite(c) ? c : 0);
  }, 0);
  if (!isFinite(total) || rows.length < 2) { left.textContent = ''; return; }
  const diff = total - sum;
  left.className = diff === 0 ? 'hint good' : 'hint bad';
  left.textContent = diff === 0
    ? 'The lines add up.'
    : (diff > 0 ? '$' + receipt.money(diff) + ' still to put somewhere.'
                : '$' + receipt.money(-diff) + ' more than the receipt.');
}

async function receiptQueue() {
  chrome('Receipts', 'Waiting on the office');
  if (!auth.allow('receipts.log')) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Not your '
      + 'account to read.</b> Receipts are the office and the owners.</div></div>';
    return;
  }
  $('view').innerHTML = loading;
  try {
    const rows = await receipt.list({ status: 'new' });
    receipt.drawQueue($('view'), rows, {});
  } catch (e) { $('view').innerHTML = oops(e, 'read the receipts'); }
}

async function receiptRecord(id) {
  chrome('Receipt', 'As sent in');
  $('view').innerHTML = loading;
  try {
    const rows = await receipt.list({});
    const r = rows.find(x => x.id === id);
    if (!r) { $('view').innerHTML = '<div class="wrap"><div class="empty">No such '
      + 'receipt.</div></div>'; return; }
    receipt.drawRecord($('view'), r, {
      canWork: auth.allow('receipts.log'),
      canOpenImage: auth.allow('receipts.images'),
    });
  } catch (e) { $('view').innerHTML = oops(e, 'open it'); }
}

/* ---------- work orders ------------------------------------------------ */
/* Owners and office read the roster; a tech does not. It is fetched when it
   can be and the field falls back to free text when it cannot - so the form
   still works for whoever is standing there, with or without the list. */
async function woPeople() {
  if (!auth.allow('users.read')) return [];
  try { return (await team.list()).users; } catch (e) { return []; }
}

async function woForm() {
  if (!auth.allow('wo.request')) {
    chrome('Work order', 'Not yours to raise');
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Not your '
      + 'account to use.</b> Work orders are rung in by the techs and the owners.'
      + '</div></div>';
    return;
  }
  chrome('Work order request', 'New');
  wo.drawForm($('view'), { equipment: DATA.equipment, customers: DATA.customers,
    people: await woPeople() });
}

async function woList() {
  const mine = !auth.allow('wo.manage');
  chrome(mine ? 'My work orders' : 'Work orders', mine ? 'Yours' : 'Called in');
  $('view').innerHTML = loading;
  try { wo.drawList($('view'), await wo.list(), { mine }); }
  catch (e) { $('view').innerHTML = oops(e, 'read the work orders'); }
}

async function woRecord(id) {
  chrome('Work order', 'As rung in');
  $('view').innerHTML = loading;
  try {
    const r = await wo.get(id);
    if (!r) { $('view').innerHTML = '<div class="wrap"><div class="empty">No such '
      + 'work order.</div></div>'; return; }
    wo.drawRecord($('view'), r,
      { canManage: auth.allow('wo.manage'), people: await woPeople() });
  } catch (e) { $('view').innerHTML = oops(e, 'open it'); }
}

/* ---------- parts ----------------------------------------------------- */
const loading = '<div class="wrap"><div class="empty">Loading…</div></div>';
const oops = (e, what) => '<div class="wrap"><div class="note warn"><b>Could not '
  + esc(what) + '.</b> ' + esc((e && e.message) || 'unknown error') + '</div></div>';

function partsForm() {
  chrome('Order parts', 'New request');
  parts.drawForm($('view'), { equipment: DATA.equipment });
}

async function partsMine() {
  chrome('My parts requests', 'Yours');
  $('view').innerHTML = loading;
  try { parts.drawMine($('view'), await parts.listRequests()); }
  catch (e) { $('view').innerHTML = oops(e, 'read your requests'); }
}

async function partsQueue() {
  chrome('Parts', 'The queue');
  $('view').innerHTML = loading;
  try {
    const [reqs, orders] = await Promise.all([parts.listRequests(), parts.listOrders()]);
    parts.drawQueue($('view'), reqs, orders);
  } catch (e) { $('view').innerHTML = oops(e, 'read the parts queue'); }
}

async function partsRequest(id) {
  chrome('Parts request', 'As asked');
  $('view').innerHTML = loading;
  try {
    const r = await parts.getRequest(id);
    if (!r) { $('view').innerHTML = '<div class="wrap"><div class="empty">No such '
      + 'request.</div></div>'; return; }
    parts.drawRequest($('view'), r, { canOrder: auth.allow('parts.order') });
  } catch (e) { $('view').innerHTML = oops(e, 'open it'); }
}

async function partsOrder(id) {
  chrome('Parts order', 'Placed');
  $('view').innerHTML = loading;
  try {
    const o = await parts.getOrder(id);
    if (!o) { $('view').innerHTML = '<div class="wrap"><div class="empty">No such '
      + 'order.</div></div>'; return; }
    parts.drawOrder($('view'), o, { canOrder: auth.allow('parts.order') });
  } catch (e) { $('view').innerHTML = oops(e, 'open it'); }
}

async function partsOrderForm() {
  chrome('New order', PICKED.length + ' request' + (PICKED.length === 1 ? '' : 's'));
  $('view').innerHTML = loading;
  try {
    const all = await parts.listRequests();
    const picked = all.filter(r => PICKED.indexOf(r.id) >= 0);
    if (!picked.length) { $('view').innerHTML = '<div class="wrap"><div class="empty">'
      + 'Nothing picked.</div></div>'; return; }
    parts.drawOrderForm($('view'), picked);
  } catch (e) { $('view').innerHTML = oops(e, 'gather those requests'); }
}

/* ---------- machines and customers ----------------------------------- */
function rigForm(arg) {
  if (!auth.allow('equipment.edit')) {
    chrome('Machines', 'Not yours to change');
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Not your '
      + 'account to change.</b> The equipment list is Mike and Stew.</div></div>';
    return;
  }
  /* arg is either a machine id, or {for: customerId} for a new one on that
     customer, or null for a new one with nothing filled in. */
  const forCust = arg && typeof arg === 'object' ? arg.for : null;
  const rig = arg && typeof arg === 'string'
    ? DATA.equipment.find(x => x.id === arg) : null;
  chrome(rig ? 'Edit ' + rig.unit : 'Add a machine', rig ? rig.customerName : 'New');
  fleet.drawMachineForm($('view'), {
    machine: rig || (forCust ? { customer: forCust } : null),
    customers: DATA.customers,
    equipment: DATA.equipment,
  });
  if (!rig && forCust) {
    const sel = $('view').querySelector('[data-m="customer"]');
    if (sel) sel.value = forCust;
  }
}

function custForm(arg) {
  if (!auth.allow('customers.edit')) {
    chrome('Customers', 'Not yours to change');
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Not your '
      + 'account to change.</b> Customer records are Mike, Stew and Jazmine.</div></div>';
    return;
  }
  const c = arg ? DATA.customers.find(x => x.id === arg) : null;
  chrome(c ? 'Edit ' + c.name : 'Add a customer', 'Customer');
  fleet.drawCustomerForm($('view'), { customer: c, equipment: DATA.equipment });
}

async function preopRecord(id) {
  chrome('Pre-op inspection', 'As signed');
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading…</div></div>';
  try {
    const rec = await preop.get(id);
    if (!rec) {
      $('view').innerHTML = '<div class="wrap"><div class="empty">No such inspection. '
        + 'It may have passed its retention date.</div></div>';
      return;
    }
    preop.drawRecord($('view'), rec, {
      canCorrect: auth.allow('preop.correct'),
      canHold: auth.allow('preop.hold'),
    });
  } catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Could not open '
      + 'it.</b> ' + esc(e.message) + '</div></div>';
  }
}

async function people() {
  chrome('People', 'Roles');
  /* The database refuses this to anybody but an owner, so this is belt and
     braces - but a permission error on screen reads like a broken app, and
     a sentence reads like a decision. */
  if (!auth.allow('users.manage')) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Not your '
      + 'account to change.</b> Who can see what is set by Mike and Stew.</div></div>';
    return;
  }
  $('view').innerHTML = '<div class="wrap"><div class="empty">Loading…</div></div>';
  try {
    const data = await team.list();
    team.draw($('view'), data, auth.currentUser());
  } catch (e) {
    $('view').innerHTML = '<div class="wrap"><div class="note warn"><b>Could not read '
      + 'the people list.</b> ' + esc(e.message) + '</div></div>';
  }
}

function perms() {
  const u = auth.currentUser();
  chrome('Permissions', 'Who sees what');
  const roles = ['tech', 'office', 'owner'];
  const h = ['<div class="wrap"><h1 class="pg">Who sees what</h1>',
    '<p class="lede">The whole matrix, so it can be argued with. The app hides what a '
    + 'role cannot do, and the database refuses it as well — hiding a button on '
    + 'its own is not security.</p>',
    '<div class="mx"><table><thead><tr><th>Can</th>'];
  roles.forEach(r => h.push('<th class="c">', esc(ROLES[r].label), '</th>'));
  h.push('</tr></thead><tbody>');
  Object.entries(CAPS).forEach(([cap, label]) => {
    h.push('<tr><td class="cap">', esc(label), '</td>');
    roles.forEach(r => {
      const yes = can(r, cap);
      // a cross, not a dot, where HARD_RULES says this is a rule and not
      // merely an absence - read straight off roles.js so the two cannot drift
      const locked = !yes && HARD_RULES.some(x => x.role === r && x.cap === cap);
      h.push('<td class="c ', yes ? 'yes' : (locked ? 'locked' : 'no'), '">',
        yes ? '✓' : (locked ? '✕' : '·'), '</td>');
    });
    h.push('</tr>');
  });
  h.push('</tbody></table></div>');
  if (CONFIG.legacy && CONFIG.legacy.url) {
    h.push('<div class="note warn"><b>The old Launcher is still up, and none of ',
      'this applies to it.</b> It has no sign-in, so anyone with that address reaches ',
      'the same tools with no role at all \u2014 the Command Center page included, ',
      'which is Mike and Stew only by convention and by nothing else. Running the two ',
      'side by side is the right way to move, but the refusals below only bite on the ',
      'day the Launcher comes down.</div>');
  }
  h.push('<div class="note warn"><b>Red crosses are the rules you set.</b> Techs never ',
    'read the master logs, the receipt images, or anyone else’s JSAs; personnel ',
    'is you and Stew only. Those five are checked by the test suite, so a later change ',
    'cannot quietly undo them.</div>');
  h.push('<div class="note"><b>Signed in as ', esc(ROLES[u.role].label), '.</b> ',
    esc(ROLES[u.role].note), '</div></div>');
  $('view').innerHTML = h.join('');
}

/* ---------- draw ------------------------------------------------------ */
function draw() {
  const u = auth.currentUser();
  document.body.classList.remove('framed');
  if (!u) { signIn(); return; }
  if (!u.role) { pending(); return; }
  const v = route.view;
  if (v === 'tool') { tool(route.arg); return; }
  if (v === 'preop') { preopForm(); return; }
  if (v === 'preoplog') { preopLog(); return; }
  if (v === 'preoprec') { preopRecord(route.arg); return; }
  if (v === 'jsa') { jsaForm(); return; }
  if (v === 'jsalog') { jsaLog(); return; }
  if (v === 'jsarec') { jsaRecord(route.arg); return; }
  if (v === 'editrig') { rigForm(route.arg); return; }
  if (v === 'editcust') { custForm(route.arg); return; }
  if (v === 'parts') { partsForm(); return; }
  if (v === 'partsmine') { partsMine(); return; }
  if (v === 'partsq') { partsQueue(); return; }
  if (v === 'preq') { partsRequest(route.arg); return; }
  if (v === 'pord') { partsOrder(route.arg); return; }
  if (v === 'pordnew') { partsOrderForm(); return; }
  if (v === 'wo') { woForm(); return; }
  if (v === 'wolist') { woList(); return; }
  if (v === 'worec') { woRecord(route.arg); return; }
  if (v === 'rrec') { receiptRecord(route.arg); return; }
  if (v === 'bookfor') { machineBook(route.arg); return; }
  if (v === 'equipment') equipment();
  else if (v === 'customer') customer(route.arg);
  else if (v === 'rig') machine(route.arg);
  else if (v === 'books') books();
  else if (v === 'logs') logs();
  else if (v === 'people') { people(); return; }
  else if (v === 'notify') { notify(); return; }
  else if (v === 'receipt') { receiptForm(); return; }
  else if (v === 'receiptq') { receiptQueue(); return; }
  else if (v === 'bookcover') { bookCoverage(); return; }
  else if (v === 'perms') perms();
  else home();
}

/* ---------- events ---------------------------------------------------- */
document.addEventListener('change', async (e) => {
  const photo = e.target.closest('#rphoto');
  if (photo && photo.files && photo.files[0]) {
    const msg = $('rscan');
    msg.className = 'msg';
    msg.textContent = 'Saving the photo…';
    try {
      const out = await receipt.scan(photo.files[0]);
      rctx.driveFileUrl = out.driveFileUrl || '';
      rctx.driveFileId = out.driveFileId || '';
      ['vendor', 'invoiceNumber', 'invoiceDate', 'amount'].forEach(k => {
        const el = $('r_' + k);
        if (el && out[k] && !el.value) el.value = out[k];
      });
      if (out.docType && $('r_docType')) $('r_docType').value = out.docType;
      syncLines();
      msg.className = out.ocrError ? 'msg' : 'msg good';
      /* A failed read is not a failed receipt: the photo is already in
         Drive, which is the part that cannot be done again later. */
      msg.textContent = out.ocrError
        ? 'Photo saved. It could not be read, so fill the fields in yourself.'
        : 'Photo saved and read. Check what it found before sending.';
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = (err && err.message) || 'The photo did not go through.';
    }
    return;
  }
  if (e.target.closest('[data-l="amount"]') || e.target.closest('#r_amount')) syncLines();
});

document.addEventListener('input', (e) => {
  if (e.target.closest('#r_amount') || e.target.closest('[data-l="amount"]')) syncLines();
  const bq = e.target.closest('#bq');
  if (bq) {
    const host = $('bhits');
    if (!host) return;
    const mid = route.arg;
    const q = String(bq.value || '').trim();
    /* Nothing typed yet: offer the books for machines that look like this
       one, which is what somebody reaches for first. */
    const rows = q ? book.find(q, 40)
      : book.like((book.forMachine(mid, bookPicks).machine) || {}, 40);
    book.drawHits(host, rows, mid);
  }
});

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-demo]');
  if (d) { auth.demoSignIn(d.dataset.demo); return; }
  const tl = e.target.closest('[data-tool]');
  if (tl) { go('tool', tl.dataset.tool); return; }
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go, null); return; }

  /* ---- parts books ---- */
  const bFor = e.target.closest('[data-bookfor]');
  if (bFor) { go('bookfor', bFor.dataset.bookfor); return; }

  const bPick = e.target.closest('[data-pick]');
  if (bPick) {
    const folder = bPick.dataset.pick;
    const mid = bPick.dataset.for;
    const row = book.library().find(r => r.folder === folder);
    if (!row) return;
    /* A judgement pick is a statement about a machine somebody else will
       trust later, so it asks why. The answer goes on the record and is
       shown wherever the book is. */
    const why = window.prompt('Why this book for this machine?\n\n'
      + 'It will be marked as a judgement everywhere it appears.');
    if (why === null) return;
    try {
      await book.savePick(mid, row, why);
      bookPicks = await book.picks();
      machineBook(mid);
    } catch (err) { alertish(err); }
    return;
  }

  /* ---- receipts ---- */
  const addLine = e.target.closest('#raddline');
  if (addLine) {
    const host = $('rlines');
    host.insertAdjacentHTML('beforeend',
      receipt.lineRow(document.querySelectorAll('[data-line]').length, '', ''));
    syncLines();
    return;
  }
  const rmLine = e.target.closest('[data-rmline]');
  if (rmLine) {
    const row = rmLine.closest('[data-line]');
    if (row) row.remove();
    syncLines();
    return;
  }
  const rrec = e.target.closest('[data-rrec]');
  if (rrec) { go('rrec', rrec.dataset.rrec); return; }

  const rsend = e.target.closest('#rsend');
  if (rsend) {
    const out = receipt.collect($('view'), rctx);
    if (out.problems.length) {
      showProblems($('rmsg'), out, $('view'));
      return;
    }
    rsend.disabled = true;
    $('rmsg').className = 'msg';
    $('rmsg').textContent = 'Sending…';
    try {
      const saved = await receipt.file(out.rec);
      /* The old sheet still gets its copy during the changeover. If that
         fails the receipt is already filed here, so it is reported and
         not treated as a failure. */
      const sheet = await receipt.alsoSheet(out.rec);
      receipt.drawRecord($('view'), saved, {
        canWork: auth.allow('receipts.log'),
        canOpenImage: auth.allow('receipts.images'),
      });
      if (sheet && sheet.ok === false) {
        $('view').insertAdjacentHTML('beforeend',
          '<div class="wrap"><div class="note warn"><b>Filed here, but the old '
          + 'spreadsheet did not get its copy.</b> Nothing is lost — tell Mike '
          + 'so the two can be squared up.</div></div>');
      }
    } catch (err) {
      rsend.disabled = false;
      $('rmsg').className = 'msg bad';
      $('rmsg').textContent = (err && err.message) || 'That did not send.';
    }
    return;
  }

  const rEntered = e.target.closest('[data-rentered]');
  if (rEntered) {
    const po = ($('r_po') || {}).value || '';
    const msg = $('rqmsg');
    if (!String(po).trim()) {
      msg.className = 'msg bad';
      msg.textContent = 'Put the Fullbay purchase order number on it first — that '
        + 'number is what ties the two together later.';
      return;
    }
    rEntered.disabled = true;
    try {
      await receipt.markEntered(rEntered.dataset.rentered, po);
      receiptRecord(rEntered.dataset.rentered);
    } catch (err) {
      rEntered.disabled = false;
      msg.className = 'msg bad';
      msg.textContent = (err && err.message) || 'That did not work.';
    }
    return;
  }

  const rQuery = e.target.closest('[data-rquery]');
  if (rQuery) {
    const why = window.prompt('What needs looking at?');
    if (why === null) return;
    try {
      await receipt.flag(rQuery.dataset.rquery, why);
      receiptRecord(rQuery.dataset.rquery);
    } catch (err) { alertish(err); }
    return;
  }

  if (e.target.id === 'pon' || e.target.id === 'poff') {
    const btn = e.target;
    const msg = $('pmsg');
    const turningOn = btn.id === 'pon';
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = turningOn ? 'Asking the phone…' : 'Switching off…';
    try {
      if (turningOn) await push.enable(); else await push.disable();
      notify();
    } catch (err) {
      btn.disabled = false;
      msg.className = 'msg bad';
      /* The reasons this fails are mostly the phone's, not the app's, and
         they are worth reading in full rather than being flattened into
         "something went wrong". */
      msg.textContent = (err && err.message) || 'That did not work.';
    }
    return;
  }
  const c = e.target.closest('[data-cust]');
  if (c) { go('customer', c.dataset.cust); return; }
  const r = e.target.closest('[data-rig]');
  if (r) { go('rig', r.dataset.rig); return; }
  const pr = e.target.closest('[data-preop]');
  if (pr) { go('preoprec', pr.dataset.preop); return; }
  const jr = e.target.closest('[data-jsa]');
  if (jr) { go('jsarec', jr.dataset.jsa); return; }

  /* ---- whichever form is on screen handles its own controls ---- */
  if (route.view === 'preop' && preop.formClick(e, $('view'))) return;
  if (route.view === 'jsa' && JTPL && jsa.formClick(e, $('view'), JTPL)) return;

  if (e.target.id === 'psubmit') {
    await file(e.target, 'pmsg', preop, TPL, 'preoprec', 'sheet');
    return;
  }
  if (e.target.id === 'jsubmit') {
    await file(e.target, 'jmsg', jsa, JTPL, 'jsarec', 'JSA');
    return;
  }

  /* ---- a stored record: corrections and holds ---- */
  const fix = e.target.closest('[data-fix]');
  if (fix) {
    fix.disabled = true;
    try {
      await preop.correct(route.arg, [Number(fix.dataset.fix)], '');
      preopRecord(route.arg);
    } catch (err) { fix.disabled = false; alertish(err); }
    return;
  }
  const hold = e.target.closest('[data-hold]');
  if (hold) {
    const on = hold.dataset.hold === 'on';
    const why = $('holdwhy') ? $('holdwhy').value.trim() : '';
    const isJsa = route.view === 'jsarec';
    hold.disabled = true;
    try {
      await (isJsa ? jsa : preop).setHold(route.arg, on, why);
      (isJsa ? jsaRecord : preopRecord)(route.arg);
    } catch (err) { hold.disabled = false; alertish(err); }
    return;
  }

  /* ---- work orders ---- */
  const wor = e.target.closest('[data-wo]');
  if (wor) { go('worec', wor.dataset.wo); return; }
  if (e.target.id === 'wsend') {
    const msg = $('wmsg');
    const out = wo.collect($('view'), { equipment: DATA.equipment,
      customers: DATA.customers, people: await woPeople() });
    if (out.problems) { showProblems(msg, out, $('view')); return; }
    e.target.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Sending…';
    try { go('worec', await wo.save(out.rec), true); }
    catch (err) {
      e.target.disabled = false;
      msg.textContent = 'It did not send: ' + ((err && err.message) || 'unknown error');
    }
    return;
  }
  const built = e.target.closest('[data-built]');
  if (built) {
    const msg = $('womsg');
    built.disabled = true;
    try {
      await wo.markBuilt(built.dataset.built, ($('w_so') || {}).value);
      woRecord(built.dataset.built);
    } catch (err) {
      built.disabled = false;
      msg.className = 'msg';
      msg.textContent = (err && err.message) || 'That did not work.';
    }
    return;
  }
  const asg = e.target.closest('[data-woassign]');
  if (asg) {
    asg.disabled = true;
    try {
      await wo.assign(asg.dataset.woassign, ($('w_assign') || {}).value, await woPeople());
      woRecord(asg.dataset.woassign);
    } catch (err) { asg.disabled = false; alertish(err); }
    return;
  }
  const wcx = e.target.closest('[data-wocancel]');
  if (wcx) {
    wcx.disabled = true;
    try { await wo.cancel(wcx.dataset.wocancel); woRecord(wcx.dataset.wocancel); }
    catch (err) { wcx.disabled = false; alertish(err); }
    return;
  }

  /* ---- parts ---- */
  const preq = e.target.closest('[data-preq]');
  if (preq) { go('preq', preq.dataset.preq); return; }
  const pord = e.target.closest('[data-pord]');
  if (pord) { go('pord', pord.dataset.pord); return; }
  if (route.view === 'parts' && parts.formClick(e, $('view'))) return;

  if (e.target.id === 'psend') {
    const msg = $('pmsg2');
    msg.className = 'msg';
    const out = parts.collect($('view'), { equipment: DATA.equipment });
    if (out.problems) { showProblems(msg, out, $('view')); return; }
    e.target.disabled = true;
    msg.textContent = 'Sending…';
    try {
      const id = await parts.save(out.rec);
      go('preq', id, true);
    } catch (err) {
      e.target.disabled = false;
      msg.textContent = 'It did not send: ' + ((err && err.message) || 'unknown error')
        + '. Nothing was lost — the request is still filled in.';
    }
    return;
  }
  if (e.target.id === 'makeorder') {
    PICKED = [...$('view').querySelectorAll('[data-pick]:checked')]
      .map(b => b.dataset.pick);
    if (!PICKED.length) return;
    go('pordnew');
    return;
  }
  if (e.target.id === 'osave') {
    const msg = $('omsg');
    msg.className = 'msg';
    const form = {};
    $('view').querySelectorAll('[data-o]').forEach(el => { form[el.dataset.o] = el.value; });
    e.target.disabled = true;
    msg.textContent = 'Saving…';
    try {
      const all = await parts.listRequests();
      const picked = all.filter(r => PICKED.indexOf(r.id) >= 0);
      const id = await parts.placeOrder(form, picked);
      PICKED = [];
      go('pord', id, true);
    } catch (err) {
      e.target.disabled = false;
      msg.textContent = (err && err.message) || 'That did not work.';
    }
    return;
  }
  const rcv = e.target.closest('[data-receive]');
  if (rcv) {
    rcv.disabled = true;
    try { await parts.receiveOrder(rcv.dataset.receive); partsOrder(rcv.dataset.receive); }
    catch (err) { rcv.disabled = false; alertish(err); }
    return;
  }
  const cxl = e.target.closest('[data-cancelreq]');
  if (cxl) {
    cxl.disabled = true;
    try { await parts.cancelRequest(cxl.dataset.cancelreq); partsRequest(cxl.dataset.cancelreq); }
    catch (err) { cxl.disabled = false; alertish(err); }
    return;
  }

  /* ---- machines and customers ---- */
  const er = e.target.closest('[data-editrig]');
  if (er) { go('editrig', er.dataset.editrig); return; }
  const ec = e.target.closest('[data-editcust]');
  if (ec) { go('editcust', ec.dataset.editcust); return; }
  const nr = e.target.closest('[data-newrigfor]');
  if (nr) { go('editrig', { for: nr.dataset.newrigfor }); return; }

  if (e.target.id === 'msave') {
    const msg = $('mmsg');
    msg.className = 'msg';
    const rec = fleet.readForm($('view'), 'm');
    const editing = typeof route.arg === 'string' ? route.arg : null;
    const problems = fleet.validateMachine(rec, DATA, editing);
    if (problems.length) {
      msg.innerHTML = problems.map(x => esc(x)).join('<br>');
      return;
    }
    const cust = DATA.customers.find(c => c.id === rec.customer);
    rec.customerName = cust ? cust.name : '';
    rec.retired = editing
      ? !!(DATA.equipment.find(x => x.id === editing) || {}).retired : false;
    e.target.disabled = true;
    msg.textContent = 'Saving…';
    try {
      const saved = await fleet.saveMachine(rec, editing);
      await loadData();
      go('rig', saved.id, true);
    } catch (err) {
      e.target.disabled = false;
      msg.textContent = 'It did not save: ' + ((err && err.message) || 'unknown error');
    }
    return;
  }
  if (e.target.id === 'mretire') {
    const id = typeof route.arg === 'string' ? route.arg : null;
    if (!id) return;
    e.target.disabled = true;
    try {
      await fleet.retireMachine(id, e.target.dataset.to === 'off');
      await loadData();
      go('rig', id, true);
    } catch (err) { e.target.disabled = false; alertish(err); }
    return;
  }
  if (e.target.id === 'csave') {
    const msg = $('cmsg');
    msg.className = 'msg';
    const rec = fleet.readForm($('view'), 'm');
    const editing = route.arg || null;
    const problems = fleet.validateCustomer(rec, DATA, editing);
    if (problems.length) {
      msg.innerHTML = problems.map(x => esc(x)).join('<br>');
      return;
    }
    e.target.disabled = true;
    msg.textContent = 'Saving…';
    try {
      const saved = await fleet.saveCustomer(rec, editing);
      await loadData();
      go('customer', saved.id, true);
    } catch (err) {
      e.target.disabled = false;
      msg.textContent = 'It did not save: ' + ((err && err.message) || 'unknown error');
    }
    return;
  }

  /* ---- People ---- */
  if (e.target.id === 'invadd') {
    const msg = $('invmsg');
    msg.className = 'msg';
    e.target.disabled = true;
    try {
      const rec = await team.invite({ name: $('inv_name').value,
        email: $('inv_email').value, role: $('inv_role').value });
      await people();
      /* redrawn, so say it on the fresh screen */
      const m2 = $('invmsg');
      if (m2) {
        m2.className = 'msg ok';
        m2.textContent = rec.name + ' is invited. They are in as soon as they sign in '
          + 'with ' + rec.email + '.';
      }
    } catch (err) {
      e.target.disabled = false;
      msg.textContent = (err && err.message) || 'That did not work.';
    }
    return;
  }
  const act = e.target.closest('[data-active]');
  if (act) {
    act.disabled = true;
    try { await team.setActive(act.dataset.active, act.dataset.to === 'on'); await people(); }
    catch (err) { act.disabled = false; alertish(err); }
    return;
  }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) {
    cancel.disabled = true;
    try { await team.cancelInvite(cancel.dataset.cancel); await people(); }
    catch (err) { cancel.disabled = false; alertish(err); }
    return;
  }

  /* ---- the first-time sign-in path ---- */
  if (e.target.id === 'firsttime') { signupMode = true; draw(); return; }
  if (e.target.id === 'backtosignin') { signupMode = false; draw(); return; }
  if (e.target.id === 'makeacct') {
    const a = $('email').value.trim(), p = $('pw').value;
    if (!a) { $('msg').textContent = 'Put your email in.'; return; }
    if (p.length < 8) {
      $('msg').textContent = 'Make the password at least 8 characters.';
      return;
    }
    try { await auth.signUpPassword(a, p); }
    catch (err) { $('msg').className = 'msg'; $('msg').textContent = friendly(err); }
    return;
  }

  if (e.target.id === 'google') {
    try { await auth.signInGoogle(); }
    catch (err) { $('msg').textContent = friendly(err); }
  }
  if (e.target.id === 'pwgo') {
    try { await auth.signInPassword($('email').value.trim(), $('pw').value); }
    catch (err) { $('msg').textContent = friendly(err); }
  }
  if (e.target.id === 'reset') {
    const a = $('email').value.trim();
    if (!a) { $('msg').textContent = 'Put your email in first.'; return; }
    try {
      await auth.sendReset(a);
      $('msg').className = 'msg ok';
      $('msg').textContent = 'Sent. Check that inbox.';
    } catch (err) { $('msg').className = 'msg'; $('msg').textContent = friendly(err); }
  }
});
/* Filing a form. Identical for both, which is why it is written once: read
   the form, refuse it with every reason at once rather than one at a time,
   and only navigate away once it is actually stored. */
/* A refused form takes you to the first thing that is wrong and marks it,
   rather than printing a list at the bottom of a long page and leaving you
   to find it. Fix that one, press again, and it walks you down. */
function showProblems(msg, out, host) {
  host.querySelectorAll('.badfield').forEach(e => e.classList.remove('badfield'));
  msg.className = 'msg';
  msg.innerHTML = out.problems.map(p => esc(p)).join('<br>');
  const el = out.at ? host.querySelector(out.at) : null;
  if (!el) { msg.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const box = el.closest('.item, .fld, .steprow, .partrow, .urg, .items') || el;
  box.classList.add('badfield');
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (typeof el.focus === 'function') {
    try { el.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
  }
}

async function file(btn, msgId, mod, tpl, view, what) {
  const msg = $(msgId);
  if (!tpl) { msg.textContent = 'The form is still loading.'; return; }
  const out = mod.collect($('view'), tpl, { equipment: DATA.equipment });
  if (out.problems) {
    showProblems(msg, out, $('view'));
    return;
  }
  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Saving…';
  try {
    const id = await mod.save(out.rec);
    go(view, id, true);
  } catch (err) {
    btn.disabled = false;
    msg.textContent = 'It did not save: ' + ((err && err.message) || 'unknown error')
      + '. Nothing was lost — the ' + what + ' is still filled in.';
  }
}

/* The pre-op checklist is redrawn when the equipment type changes, and for
   fall protection when the frequency does. On the JSA, changing the LOTO
   answer opens or closes its details. */
document.addEventListener('change', (e) => {
  const d = e.target.dataset || {};
  if ((d.f === 'eqType' || d.f === 'inspFrequency') && TPL) {
    preop.drawChecklist($('view'), TPL);
  }
  if (d.j === 'lotoRequired' && JTPL) jsa.sync($('view'), JTPL);
  if (d.pick) {
    const bar = $('pickbar');
    if (bar) {
      const n = $('view').querySelectorAll('[data-pick]:checked').length;
      bar.hidden = n === 0;
      const b = $('makeorder');
      if (b) {
        b.textContent = n === 1 ? 'Put this one on an order'
          : 'Put these ' + n + ' on an order';
      }
    }
  }
  if (d.role) {
    const sel = e.target;
    sel.disabled = true;
    team.setRole(d.role, sel.value)
      .then(people)
      .catch(err => { sel.disabled = false; alertish(err); people(); });
  }
});

/* No window.alert anywhere - a modal dialog freezes the page for everyone,
   including anything driving it. Failures go on the page. */
function alertish(err) {
  const where = $('view').querySelector('.wrap') || $('view');
  const n = document.createElement('div');
  n.className = 'note warn';
  n.innerHTML = '<b>That did not go through.</b> '
    + esc((err && err.message) || 'unknown error');
  where.prepend(n);
}

$('back').addEventListener('click', back);
$('signout').addEventListener('click', async () => {
  stack.length = 0; route = { view: 'home', arg: null };
  await auth.signOut();
});

function friendly(err) {
  const c = (err && err.code) || '';
  if (c.includes('wrong-password') || c.includes('invalid-credential')) {
    return 'That email and password do not match an account.';
  }
  if (c.includes('user-not-found')) return 'No account with that email.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a minute.';
  if (c.includes('popup-closed')) return 'Sign-in window closed before it finished.';
  if (c.includes('email-already-in-use')) {
    return 'There is already a sign-in for that address — use Sign in, or the reset link.';
  }
  if (c.includes('weak-password')) return 'That password is too short.';
  if (c.includes('invalid-email')) return 'That does not look like an email address.';
  if (c.includes('operation-not-allowed')) {
    return 'Setting up new sign-ins is switched off on the project.';
  }
  if (c.includes('network')) return 'No connection to the sign-in service.';
  return (err && err.message) || 'Sign-in failed.';
}

/* ---------- arriving from a notification -------------------------------
   A notification that lands you on the home screen has made you go and
   find the thing it just told you about. The worker either opens the app
   with ?go=… or, if it is already open, posts a message - both end up
   here. The parameter is scrubbed off the address afterwards so a refresh
   does not keep bouncing you back to the same screen.

   Anything arriving this way is a VIEW NAME and nothing else: it is
   checked against the list below before it is used, so a doctored link
   cannot route into a screen the person's role would not otherwise draw -
   the screens check their own capability anyway. */
const FROM_PUSH = ['partsq', 'wolist', 'preoplog', 'partsmine'];

function landFromPush(where) {
  if (!where || FROM_PUSH.indexOf(where) < 0) return false;
  go(where, null, true);
  return true;
}

function pushParam() {
  try {
    const u = new URL(window.location.href);
    const g = u.searchParams.get('go');
    if (!g) return '';
    u.searchParams.delete('go');
    window.history.replaceState({}, '', u.pathname + (u.search || '') + u.hash);
    return g;
  } catch (e) { return ''; }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.bsds === 'go') landFromPush(d.go);
  });
}

/* ---------- start ----------------------------------------------------- */
$('demobar').hidden = !DEMO;
let landed = false;
auth.onUser(async (u) => {
  if (u && u.role && !DATA.equipment.length) {
    try { await loadData(); } catch (e) { /* drawn empty rather than blank */ }
  }
  if (!u) { stack.length = 0; route = { view: 'home', arg: null }; }
  /* Only once, and only after the role is known - routing a signed-out
     person straight at the parts queue would just show them the door. */
  if (u && u.role && !landed) {
    landed = true;
    if (landFromPush(pushParam())) return;
  }
  draw();
});
auth.start();
