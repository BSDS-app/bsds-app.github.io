/* What is waiting on the person who just opened the app.
 *
 * READ THIS BEFORE EXTENDING IT: this band is only worth anything while it
 * is short. Every line added to it makes the other lines less likely to be
 * read, and the first line people learn to skip is the one that was there
 * every single day. So the test for a new line is not "would this be useful
 * to know" - almost anything passes that - it is "does somebody have to DO
 * something about this today, and will it stop being here once they have?"
 *
 * A count that is never zero is decoration. A rig that is down is not.
 *
 * The honest limitation, stated here because it is easy to forget once the
 * band looks good: NONE OF THIS REACHES ANYBODY. It appears when the app is
 * opened and not before. Sending a rig-down to a phone needs something
 * server-side, which means the Blaze plan; what that would send is exactly
 * what gather() returns, so switching it on later is a sender, not a
 * rewrite.
 */
import * as auth from './auth.js';
import * as parts from './parts.js';
import * as preop from './preop.js';
import * as fleet from './fleet.js';
import * as wo from './workorders.js';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

/* level: 'stop' - something is not working and is costing money now
 *        'soon' - needs doing today-ish
 *        'note' - worth knowing, no hurry */
export async function gather(data) {
  const me = auth.currentUser();
  if (!me || !me.role) return [];
  const out = [];
  const can = c => auth.allow(c);

  /* Parts the field is waiting on. */
  if (can('parts.order')) {
    try {
      const reqs = await parts.listRequests();
      const open = reqs.filter(r => r.status === 'open');
      const down = open.filter(r => r.urgency === 'down');
      if (down.length) {
        out.push({ level: 'stop', go: 'partsq',
          text: plural(down.length, 'rig') + ' down waiting on parts',
          why: down.map(r => r.unit).filter(Boolean).join(', ') });
      }
      const rest = open.length - down.length;
      if (rest) {
        out.push({ level: 'soon', go: 'partsq',
          text: plural(rest, 'parts request') + ' to order' });
      }
      const lookups = open.filter(parts.needsLookup).length;
      if (lookups) {
        out.push({ level: 'note', go: 'partsq',
          text: plural(lookups, 'request') + ' with a part number to find' });
      }
    } catch (e) { /* a band that cannot load is not worth an error screen */ }
  }

  /* Defects nobody has signed off. These are the ones that also keep a
     pre-op from ever expiring, so they are not just a to-do - they are a
     record that stays open until somebody closes it. */
  if (can('preop.log')) {
    try {
      const sheets = await preop.list({});
      const openDef = sheets.filter(s => preop.openDefects(s) > 0);
      if (openDef.length) {
        const n = openDef.reduce((a, s) => a + preop.openDefects(s), 0);
        out.push({ level: 'stop', go: 'preoplog',
          text: plural(n, 'defect') + ' nobody has signed off',
          why: 'on ' + plural(openDef.length, 'pre-op') });
      }
    } catch (e) { /* ignore */ }
  }

  /* A tech only ever sees his own, and only while it is still open - once
     it is ordered there is nothing for him to do but wait. */
  if (!can('parts.order') && can('parts.request')) {
    try {
      const mine = (await parts.listRequests()).filter(r => r.status === 'open');
      if (mine.length) {
        out.push({ level: 'note', go: 'partsmine',
          text: plural(mine.length, 'parts request') + ' not ordered yet' });
      }
    } catch (e) { /* ignore */ }
  }

  /* Work orders somebody rang in and nobody has built yet. */
  if (can('wo.manage')) {
    try {
      const open = (await wo.list()).filter(r => r.status === 'open');
      if (open.length) {
        out.push({ level: 'soon', go: 'wolist',
          text: plural(open.length, 'work order') + ' to build in Fullbay',
          why: open.map(r => r.customerName).filter(Boolean).slice(0, 3).join(', ') });
      }
    } catch (e) { /* ignore */ }
  } else if (can('wo.request')) {
    /* His end of the same loop: what he rang in, and the service order
       number coming back - which is the only reason he opens this list. */
    try {
      const his = await wo.list();
      const ready = his.filter(r => r.status === 'built' && r.soNumber);
      if (ready.length) {
        out.push({ level: 'note', go: 'wolist',
          text: plural(ready.length, 'work order') + ' built',
          why: 'SO ' + ready.map(r => r.soNumber).slice(0, 3).join(', ') });
      }
      const waiting = his.filter(r => r.status === 'open').length;
      if (waiting) {
        out.push({ level: 'note', go: 'wolist',
          text: plural(waiting, 'work order') + ' rung in, not built yet' });
      }
    } catch (e) { /* ignore */ }
  }

  /* Machines whose parts book cannot be matched. Not urgent on any given
     day, which is exactly why it needs somewhere to sit and be counted. */
  if (can('equipment.edit') && data && data.equipment) {
    const n = fleet.needSerial(data.equipment).length;
    if (n) {
      out.push({ level: 'note', go: 'equipment',
        text: plural(n, 'machine') + ' with no serial, so no parts book' });
    }
  }

  const rank = { stop: 0, soon: 1, note: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export function draw(host, items) {
  if (!items.length) {
    host.innerHTML = '';
    return;
  }
  const h = ['<div class="alerts">'];
  items.forEach(i => h.push('<button class="alert ', esc(i.level), '" data-go="',
    esc(i.go), '"><span class="t">', esc(i.text), '</span>',
    i.why ? '<span class="w">' + esc(i.why) + '</span>' : '',
    '<span class="go">›</span></button>'));
  h.push('</div>');
  host.innerHTML = h.join('');
}
