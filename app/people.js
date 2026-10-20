/* Who is on the app, and what they may see.
 *
 * The point of this screen is that nobody has to open the Firebase console
 * to hire somebody, move them, or shut them out the day they leave. That is
 * worth building properly because the console is where mistakes are
 * expensive and invisible.
 *
 * How somebody gets added, in full:
 *
 *   1. An owner writes an INVITATION here: a name, an email address, a role.
 *   2. That person opens the app. A Workspace account signs in with Google;
 *      a tech taps "First time here" and sets a password.
 *   3. On that first sign-in the app turns the invitation into their user
 *      record, with the role the invitation named, and clears the
 *      invitation. (auth.js, claim())
 *
 * Nothing in step 2 admits anybody. An account with no user record is shown
 * the "not admitted" screen and the database hands it nothing, so a stranger
 * who finds the address and makes an account gets exactly as far as the door.
 * What admits somebody is step 1, which only an owner can do.
 *
 * Leaving is switching OFF, never deleting: their pre-ops and JSAs point
 * back at their record, and deleting it turns a signed sheet into paperwork
 * nobody filed.
 *
 * The one thing an owner cannot do here is change their own role or switch
 * themselves off. That is not a courtesy - it is the rule that means no
 * sequence of clicks leaves the company locked out of its own app. It is
 * enforced in firestore.rules as well as here.
 */
import * as auth from './auth.js';
import { ROLES } from './roles.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Roles an owner can hand out from this screen. `customer` exists in the
   matrix but is switched off until Phase 2, so it is not offered. */
export const ASSIGNABLE = ['tech', 'office', 'owner'];

export const normalEmail = e => String(e || '').trim().toLowerCase();
const looksLikeEmail = e => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(normalEmail(e));

/* ---------- demo ------------------------------------------------------ */

const D_USERS = 'bsds.people', D_INV = 'bsds.invites';
const readLocal = (k, dflt) => {
  try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : dflt; }
  catch (e) { return dflt; }
};
const writeLocal = (k, v) => {
  try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
};
function demoUsers() {
  const over = readLocal(D_USERS, {});
  return auth.demoPeople().map(p => ({ uid: p.uid, name: p.name, email: p.email,
    role: p.role, active: true, ...(over[p.uid] || {}) }));
}

/* ---------- reading --------------------------------------------------- */

export async function list() {
  const me = auth.currentUser();
  if (me && me.demo) {
    return { users: demoUsers(), invites: readLocal(D_INV, []) };
  }
  const { d, m } = await auth.db();
  const [us, inv] = await Promise.all([
    m.getDocs(m.collection(d, 'users')),
    m.getDocs(m.collection(d, 'invites')),
  ]);
  return {
    users: us.docs.map(x => ({ uid: x.id, ...x.data() })),
    invites: inv.docs.map(x => ({ email: x.id, ...x.data() })),
  };
}

/* ---------- writing --------------------------------------------------- */

export async function invite({ name, email, role }) {
  const key = normalEmail(email);
  if (!name || !name.trim()) throw new Error('Put a name on it.');
  if (!looksLikeEmail(key)) throw new Error('That does not look like an email address.');
  if (ASSIGNABLE.indexOf(role) < 0) throw new Error('Pick a role.');
  const me = auth.currentUser();
  const rec = { name: name.trim(), email: key, role, by: me.name,
    at: new Date().toISOString() };
  if (me.demo) {
    const all = readLocal(D_INV, []).filter(i => i.email !== key);
    all.push(rec);
    writeLocal(D_INV, all);
    return rec;
  }
  const { d, m } = await auth.db();
  await m.setDoc(m.doc(d, 'invites', key), rec);
  return rec;
}

export async function cancelInvite(email) {
  const key = normalEmail(email);
  const me = auth.currentUser();
  if (me.demo) {
    writeLocal(D_INV, readLocal(D_INV, []).filter(i => i.email !== key));
    return;
  }
  const { d, m } = await auth.db();
  await m.deleteDoc(m.doc(d, 'invites', key));
}

/* Both of these refuse to act on yourself before they go near the database.
   The rules refuse it too; this is so the refusal is a sentence rather than
   a permission error. */
export async function setRole(uid, role) {
  const me = auth.currentUser();
  if (uid === me.uid) throw new Error('You cannot change your own role. Stew can.');
  if (ASSIGNABLE.indexOf(role) < 0) throw new Error('Not a role.');
  if (me.demo) {
    const over = readLocal(D_USERS, {});
    over[uid] = { ...(over[uid] || {}), role };
    writeLocal(D_USERS, over);
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'users', uid), { role });
}

export async function setActive(uid, active) {
  const me = auth.currentUser();
  if (uid === me.uid) {
    throw new Error('You cannot switch yourself off. That is the one account '
      + 'that has to stay able to let everyone else back in.');
  }
  if (me.demo) {
    const over = readLocal(D_USERS, {});
    over[uid] = { ...(over[uid] || {}), active: !!active };
    writeLocal(D_USERS, over);
    return;
  }
  const { d, m } = await auth.db();
  await m.updateDoc(m.doc(d, 'users', uid), { active: !!active });
}

/* ---------- drawing --------------------------------------------------- */

const roleLabel = r => (ROLES[r] ? ROLES[r].label : 'No role');

function personRow(p, me) {
  const isMe = p.uid === me.uid;
  const off = p.active === false;
  return '<div class="prow' + (off ? ' off' : '') + '" data-uid="' + esc(p.uid) + '">'
    + '<div class="who">'
    + '<b>' + esc(p.name || p.email || 'Unnamed')
    + (isMe ? '<em>you</em>' : '') + '</b>'
    + '<span>' + esc(p.email || 'no email on the record') + '</span>'
    + '</div>'
    + '<div class="act">'
    + (isMe
      ? '<span class="pill">' + esc(roleLabel(p.role)) + '</span>'
        + '<span class="hint">your own account</span>'
      : '<select data-role="' + esc(p.uid) + '">'
        + ASSIGNABLE.map(r => '<option value="' + r + '"' + (p.role === r ? ' selected' : '')
            + '>' + esc(roleLabel(r)) + '</option>').join('')
        + '</select>'
        + '<button type="button" class="mini" data-active="' + esc(p.uid) + '" '
        + 'data-to="' + (off ? 'on' : 'off') + '">'
        + (off ? 'Switch back on' : 'Switch off') + '</button>')
    + '</div></div>';
}

function inviteRow(i) {
  return '<div class="prow pending" data-invite="' + esc(i.email) + '">'
    + '<div class="who"><b>' + esc(i.name) + '<em>waiting</em></b>'
    + '<span>' + esc(i.email) + '</span></div>'
    + '<div class="act"><span class="pill">' + esc(roleLabel(i.role)) + '</span>'
    + '<button type="button" class="mini" data-cancel="' + esc(i.email) + '">Cancel</button>'
    + '</div></div>';
}

export function draw(host, data, me) {
  const live = data.users.filter(p => p.active !== false);
  const off = data.users.filter(p => p.active === false);
  const h = ['<div class="wrap"><h1 class="pg">People</h1>',
    '<p class="lede">Everyone who can open the app, and what each of them sees. ',
    'Adding somebody here is the whole process — nobody has to go near Firebase.</p>'];

  h.push('<h2 class="sec">On the app</h2><div class="plist">',
    live.map(p => personRow(p, me)).join(''), '</div>');

  if (data.invites.length) {
    h.push('<h2 class="sec">Invited, not signed in yet</h2><div class="plist">',
      data.invites.map(inviteRow).join(''), '</div>',
      '<p class="hint">They become a real account the first time they sign in. ',
      'Until then they can see nothing.</p>');
  }

  if (off.length) {
    h.push('<h2 class="sec">Switched off</h2><div class="plist">',
      off.map(p => personRow(p, me)).join(''), '</div>',
      '<p class="hint">Still on file because their paperwork points back at them. ',
      'They cannot sign in.</p>');
  }

  h.push('<h2 class="sec">Add somebody</h2>',
    '<div class="panel"><div class="fgrid">',
    '<div class="fld"><label for="inv_name">Name</label>',
    '<input id="inv_name" type="text" autocomplete="off"></div>',
    '<div class="fld"><label for="inv_email">Email</label>',
    '<input id="inv_email" type="email" inputmode="email" autocomplete="off" ',
    'spellcheck="false"></div>',
    '<div class="fld"><label for="inv_role">Role</label><select id="inv_role">',
    ASSIGNABLE.map(r => '<option value="' + r + '"' + (r === 'tech' ? ' selected' : '')
      + '>' + esc(roleLabel(r)) + '</option>').join(''),
    '</select></div></div>',
    '<p class="msg" id="invmsg"></p>',
    '<button type="button" class="btn primary" id="invadd">Invite them</button>',
    '<p class="hint">A Broken Spoke email signs in with Google. Anyone else taps ',
    '<b>First time here</b> on the sign-in screen and sets their own password — ',
    'the invitation is what lets them in, not the password.</p>',
    '</div>');

  h.push('<div class="note"><b>What each role sees.</b> ',
    ASSIGNABLE.map(r => '<b>' + esc(roleLabel(r)) + '</b> — ' + esc(ROLES[r].note)).join('<br>'),
    '</div>');
  h.push('<div class="note warn"><b>Switch people off; do not delete them.</b> ',
    'Their pre-ops and JSAs point back at their record, so deleting it turns a ',
    'signed sheet into paperwork nobody filed. Switching off is instant, total, ',
    'and can be undone.</div>');
  h.push('</div>');
  host.innerHTML = h.join('');
}
