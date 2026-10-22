/* Finding a part number on a printed parts-list page.
 *
 * One small module so the app and tools/check_parts.mjs agree exactly: the
 * checker tries every part in every book the same way a phone does.
 *
 * Two things learned from the real books:
 *  - The Toolman index writes a REVISION LETTER after about half the part
 *    numbers (04600170a). The printed parts list does not - it says
 *    046 001 70. So the number is looked for with and without that letter.
 *  - The printed number is spaced (046 001 70) and may come out of the PDF
 *    as one piece of text or several. Comparing letters and digits only, on
 *    the page's text joined up, finds it either way.
 */
export const key = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/* The keys to look for, most exact first. */
export function partKeys(part) {
  const k = key(part);
  if (!k) return [];
  const out = [k];
  /* The revision letter is written lower-case and follows a digit
     (04600170a, AF00100008a); letters that are part of the number are
     capitals (AF0 010 0008, BG00334706). So only a trailing lower-case
     letter is taken off. */
  const m = String(part).trim().match(/^(.*\d)[a-z]{1,2}$/);
  if (m && key(m[1]) !== k) out.push(key(m[1]));
  return out;
}

/* Text pieces of one page -> what the matcher compares against. Kept as a
   list of items with their running offsets, so a hit can be traced back to
   the pieces that make it up (for the orange box). */
export function pageKey(items) {
  let s = '';
  const at = [];
  (items || []).forEach((it, i) => {
    const k = key(it && it.str);
    if (!k) return;
    at.push({ i, from: s.length, to: s.length + k.length });
    s += k;
  });
  return { s, at };
}

/* Does `k` occur here as a whole number - starting where a piece of text
   starts and ending where one ends - rather than as the middle of some
   longer number? */
function whole(pk, k) {
  let from = pk.s.indexOf(k);
  while (from > -1) {
    const to = from + k.length;
    if (pk.at.some(a => a.from === from) && pk.at.some(a => a.to === to)) return true;
    from = pk.s.indexOf(k, from + 1);
  }
  return false;
}

/* Is the part on this page? Returns the key that matched, or ''. With
   `strict`, only as a whole number - the app looks strictly first and falls
   back to loose only when no page has it whole. */
export function onPage(pk, part, strict) {
  for (const k of partKeys(part)) {
    if (pk.s.indexOf(k) > -1 && (!strict || whole(pk, k))) return k;
  }
  return '';
}

/* Which text items make up each place the part is printed. */
export function itemsFor(pk, part) {
  const k = onPage(pk, part);
  if (!k) return [];
  const hits = [];
  let from = pk.s.indexOf(k);
  while (from > -1) {
    const to = from + k.length;
    hits.push(pk.at.filter(a => a.to > from && a.from < to).map(a => a.i));
    from = pk.s.indexOf(k, from + 1);
  }
  return hits;
}
