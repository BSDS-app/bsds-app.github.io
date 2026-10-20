/* How long a safety record is kept, and what stops it being deleted.
 *
 * This is shared between the pre-op and the JSA on purpose. It is date
 * arithmetic that decides whether a compliance record still exists, so there
 * must be exactly one copy of it. Two copies drift, and the drift is only
 * ever noticed when something that should have been kept is gone.
 *
 * The rule in one sentence: a record gets an expiry date unless something is
 * holding it open, and a record with no expiry date is never deleted.
 *
 * Two things hold a record open:
 *
 *   hold     - a legal hold, set by an owner. Evidence in an incident, a
 *              citation contest, a customer dispute.
 *   blocked  - something about the record itself. On a pre-op that is an
 *              uncorrected defect: 30 CFR 56.14100(d) keeps a defect record
 *              "until the defects are corrected", which is a different clock
 *              from the one-year examination record in 56.18002(b). The JSA
 *              has no equivalent, and passes false.
 *
 * Returning null for "no expiry" is not a convenience - it is the mechanism.
 * A Firestore TTL policy skips any document whose timestamp field is absent
 * or null, so a held record is not a record the deleter is politely asked to
 * skip; it is a record the deleter cannot see a date on. Nothing has to
 * remember to check the hold.
 */

export const asDate = v => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();   // Firestore Timestamp
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

/* `filed` is when the work happened. `since` is a later date the clock should
   run from instead, if there is one - on a pre-op, when the last defect was
   signed off as corrected. The later of the two wins, so fixing something in
   March does not start the clock from last October. */
export function expiryFor({ hold, filed, since, blocked }, days) {
  if (hold) return null;
  if (blocked) return null;
  const a = asDate(filed);
  if (!a) return null;
  const b = asDate(since);
  const base = b && b > a ? b : a;
  const out = new Date(base.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

const fmt = d => d.toLocaleDateString(undefined,
  { year: 'numeric', month: 'long', day: 'numeric' });

/* One sentence a person can act on, plus a kind the screen can colour by. */
export function describe({ hold, holdReason, blockedText, expires }) {
  if (hold) {
    return { kind: 'hold', text: 'On legal hold — this record will not be deleted'
      + (holdReason ? ' (' + holdReason + ')' : '') };
  }
  if (blockedText) return { kind: 'open', text: blockedText };
  const e = asDate(expires);
  if (!e) return { kind: 'none', text: 'No retention date on this record' };
  return { kind: 'due', when: e, text: 'Scheduled to drop off ' + fmt(e) };
}
