/* The shell: who is signed in, what they may see, and where they can get to.
 *
 * Every screen is drawn from the same two questions - allow(cap) and the
 * route - so adding a tool is one entry in config.js and one capability in
 * roles.js, not a new wing of the building.
 */
import { CONFIG, DEMO } from './config.js';
import { ROLES, CAPS, GRANTS, HARD_RULES, can } from './roles.js';
import * as auth from './auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let DATA = { customers: [], equipment: [] };
let route = { view: 'home', arg: null };
const stack = [];

/* ---------- data ------------------------------------------------------ */
async function loadData() {
  if (DEMO) {
    const [c, e] = await Promise.all([
      fetch('seed/customers.json').then(r => r.json()),
      fetch('seed/equipment.json').then(r => r.json()),
    ]);
    DATA = { customers: c, equipment: e };
    return;
  }
  const { d, m } = await auth.db();
  const [cs, es] = await Promise.all([
    m.getDocs(m.collection(d, 'customers')),
    m.getDocs(m.collection(d, 'equipment')),
  ]);
  DATA = {
    customers: cs.docs.map(x => ({ id: x.id, ...x.data() })),
    equipment: es.docs.map(x => ({ id: x.id, ...x.data() })),
  };
}

/* A tool on our own site can be shown inside the app, with the app's bar and
   its Back button still above it. Anything else - Fullbay, a parts book on
   claude.ai - is somebody else's site and has to open in its own tab. */
const OURS = 'https://bsds-app.github.io/';
const inApp = url => typeof url === 'string' && url.indexOf(OURS) === 0;

const machinesOf = cid => DATA.equipment.filter(e => e.customer === cid);
const bookFor = serial => CONFIG.books.find(b => b.serial && serial && b.serial === serial);

/* ---------- navigation ------------------------------------------------ */
function go(view, arg) {
  stack.push({ ...route, scroll: window.scrollY });
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
function chrome(title, sub) {
  const u = auth.currentUser();
  $('ttl').innerHTML = esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '');
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
  h.push('<div class="signin"><div class="mark"><b>Broken Spoke</b>',
    '<span>Drilling Solutions</span></div>');

  if (DEMO) {
    h.push('<div class="panel"><label>Open the app as</label>',
      '<div class="people">');
    auth.demoPeople().forEach(p => {
      h.push('<button data-demo="', p.uid, '"><span class="nm">', esc(p.name),
        '</span><span class="rl">', esc(ROLES[p.role].label), '</span></button>');
    });
    h.push('</div><p class="tiny">Preview. No accounts, no data written. ',
      'Pick a person to see exactly what they get.</p></div>');
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
  chrome('Broken Spoke', u.name);
  const h = ['<div class="wrap">'];

  const tiles = [];
  for (const [key, t] of Object.entries(CONFIG.tools)) {
    if (!auth.allow(t.cap)) continue;
    if (!t.url) {
      tiles.push(`<div class="tile off"><b>${esc(t.title)}</b>`
        + `<span>${esc(t.blurb)}</span><em>No address configured yet</em></div>`);
    } else if (inApp(t.url)) {
      tiles.push(`<button class="tile" data-tool="${esc(key)}">`
        + `<b>${esc(t.title)}</b><span>${esc(t.blurb)}</span></button>`);
    } else {
      tiles.push(`<a class="tile out" href="${esc(t.url)}" target="_blank" rel="noopener">`
        + `<b>${esc(t.title)}</b><span>${esc(t.blurb)}</span>`
        + `<em class="leaves">Opens in a new tab</em></a>`);
    }
  }
  if (tiles.length) {
    h.push('<h2 class="sec">Tools</h2><div class="tiles">', tiles.join(''), '</div>');
  }

  /* While the old Launcher is still up, everyone gets a door back to it. */
  if (CONFIG.legacy && CONFIG.legacy.url) {
    h.push('<h2 class="sec">Still running</h2><div class="tiles">',
      `<button class="tile legacy" data-tool="__legacy">`,
      `<b>${esc(CONFIG.legacy.title)}</b><span>${esc(CONFIG.legacy.blurb)}</span></button>`,
      '</div>');
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
  }
  if (auth.allow('users.manage')) {
    nav.push(['people', 'People', 'Who can see what']);
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
}

function equipment() {
  chrome('Machines', DATA.equipment.length + ' rigs');
  const h = ['<div class="wrap"><h1 class="pg">Machines</h1>',
    '<p class="lede">Straight off the Fullbay equipment export. Pick a customer, ',
    'then a rig, and the app gathers what it has on that serial.</p>',
    '<div class="find"><input id="q" type="search" placeholder="Customer, unit, serial or model" ',
    'autocomplete="off" spellcheck="false"></div><div id="hits"></div></div>'];
  $('view').innerHTML = h.join('');
  drawHits('');
  $('q').addEventListener('input', e => drawHits(e.target.value));
}

function drawHits(term) {
  const t = term.trim().toUpperCase();
  const h = [];
  if (!t) {
    h.push('<div class="list">');
    DATA.customers.forEach(c => {
      const n = machinesOf(c.id).length;
      h.push('<button class="row" data-cust="', esc(c.id), '">',
        '<span class="nm">', esc(c.name), '</span>',
        '<span class="ct"><b>', n, '</b>rig', n === 1 ? '' : 's', '</span></button>');
    });
    h.push('</div>');
  } else {
    const hits = DATA.equipment.filter(e =>
      [e.customerName, e.unit, e.serial, e.model, e.nickname]
        .join(' ').toUpperCase().includes(t));
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
  return '<button class="row" data-rig="' + esc(e.id) + '">'
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
  $('view').innerHTML = '<div class="wrap"><h1 class="pg">' + esc(c ? c.name : cid) + '</h1>'
    + '<p class="lede">' + ms.length + ' machine' + (ms.length === 1 ? '' : 's') + ' on file.</p>'
    + '<div class="list">' + ms.map(e => machineRow(e, false)).join('') + '</div></div>';
}

function machine(id) {
  const e = DATA.equipment.find(x => x.id === id);
  if (!e) { $('view').innerHTML = '<div class="wrap"><div class="empty">No such machine.</div></div>'; return; }
  chrome(e.unit, e.customerName);
  const bk = bookFor(e.serial);
  const h = ['<div class="wrap">',
    '<h1 class="pg">', esc(e.unit), e.nickname ? ' · ' + esc(e.nickname) : '', '</h1>',
    '<p class="lede">', esc(e.customerName), '</p>',
    '<div class="spec">',
    cell('Serial', e.serial), cell('Make', e.make), cell('Model', e.modelOnly || e.model),
    cell('Year', e.year), cell('Meter', e.meter == null ? '' : e.meter.toLocaleString() + ' mi'),
    '</div>'];

  h.push('<h2 class="sec">Documentation</h2>');
  if (bk) {
    h.push('<div class="tiles"><a class="tile" href="', esc(bk.url),
      '" target="_blank" rel="noopener"><b>Parts book</b><span>', esc(bk.title),
      '</span></a></div>');
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

function books() {
  chrome('Parts books', 'Library');
  const h = ['<div class="wrap"><h1 class="pg">Parts books</h1>',
    '<p class="lede">What has been converted so far. Each one opens in its own tab; ',
    'they move inside the app once storage is switched on.</p>',
    '<h2 class="sec">By machine</h2><div class="tiles">'];
  CONFIG.books.forEach(b => h.push('<a class="tile" href="', esc(b.url),
    '" target="_blank" rel="noopener"><b>', esc(b.title), '</b><span>',
    b.serial ? 's/n ' + esc(b.serial) : 'no serial', '</span></a>'));
  h.push('</div><h2 class="sec">Schematics and manuals</h2><div class="tiles">');
  CONFIG.shelves.forEach(s => h.push('<a class="tile" href="', esc(s.url),
    '" target="_blank" rel="noopener"><b>', esc(s.title), '</b><span>Reference</span></a>'));
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
  $('view').innerHTML = '<div class="wrap"><h1 class="pg">Logs</h1>'
    + '<p class="lede">These still live in their spreadsheets behind the Apps Script '
    + 'backends. They move into the app in the next slice; the permission rule that '
    + 'keeps them off the techs’ accounts is already in force.</p>'
    + '<div class="note"><b>Not wired up yet.</b> Nothing here is wrong — it is '
    + 'the next piece of work, not a bug.</div></div>';
}

function people() {
  chrome('People', 'Roles');
  const h = ['<div class="wrap"><h1 class="pg">People</h1>',
    '<p class="lede">An account with no role here cannot see anything, which is how '
    + 'somebody leaving is handled: switch them off, not delete them.</p>',
    '<div class="list">'];
  auth.demoPeople().forEach(p => {
    h.push('<button class="row" data-noop="1"><span><span class="nm">', esc(p.name),
      '</span><span class="sub">', esc(p.email), '</span></span>',
      '<span class="ct"><b>', esc(ROLES[p.role].label), '</b></span></button>');
  });
  h.push('</div>');
  if (DEMO) {
    h.push('<div class="note"><b>Preview list.</b> The real one comes from the ',
      'accounts in Firebase. Adding and switching people off is the next piece here.</div>');
  }
  h.push('</div>');
  $('view').innerHTML = h.join('');
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
  if (v === 'equipment') equipment();
  else if (v === 'customer') customer(route.arg);
  else if (v === 'rig') machine(route.arg);
  else if (v === 'books') books();
  else if (v === 'logs') logs();
  else if (v === 'people') people();
  else if (v === 'perms') perms();
  else home();
}

/* ---------- events ---------------------------------------------------- */
document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-demo]');
  if (d) { auth.demoSignIn(d.dataset.demo); return; }
  const tl = e.target.closest('[data-tool]');
  if (tl) { go('tool', tl.dataset.tool); return; }
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go, null); return; }
  const c = e.target.closest('[data-cust]');
  if (c) { go('customer', c.dataset.cust); return; }
  const r = e.target.closest('[data-rig]');
  if (r) { go('rig', r.dataset.rig); return; }

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
  if (c.includes('network')) return 'No connection to the sign-in service.';
  return (err && err.message) || 'Sign-in failed.';
}

/* ---------- start ----------------------------------------------------- */
$('demobar').hidden = !DEMO;
auth.onUser(async (u) => {
  if (u && u.role && !DATA.equipment.length) {
    try { await loadData(); } catch (e) { /* drawn empty rather than blank */ }
  }
  if (!u) { stack.length = 0; route = { view: 'home', arg: null }; }
  draw();
});
auth.start();
