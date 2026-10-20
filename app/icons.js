/* A small set of line icons for the tiles.
 *
 * Drawn rather than borrowed: the Launcher uses emoji, which render
 * differently on every phone and age badly. These are 24-grid stroke paths
 * that inherit colour from the tile, so one tile style covers all of them.
 *
 * Keep the set small. An icon is only doing work while the tiles are
 * telling things apart at a glance - a different picture on every button
 * is just a second thing to read.
 */
const P = {
  /* clipboard with a tick - a walk-around that got signed off */
  preop: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z'
       + 'M8 6H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2'
       + 'M9 14l2 2 4-4',
  /* hazard triangle - the JSA */
  jsa: 'M12 4.5 2.8 20h18.4L12 4.5z M12 10v4 M12 17.2v.1',
  /* box - parts */
  parts: 'M3 8l9-4 9 4v8l-9 4-9-4V8z M3 8l9 4 9-4 M12 12v8',
  /* spanner - a rebuild kit */
  wrench: 'M14.5 6a3.5 3.5 0 0 0 4.6 4.6l-8 8a2.5 2.5 0 0 1-3.6-3.5l8-8z'
        + 'M14.5 6 17 3.5 M19.1 10.6 21.5 8',
  /* award ribbon - training certificate */
  cert: 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M9 12.5 7.5 21 12 18.5 16.5 21 15 12.5',
  /* dashboard - the command centre */
  command: 'M4 4h7v6H4z M13 4h7v4h-7z M13 10h7v10h-7z M4 12h7v8H4z',
  /* receipt */
  receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3z M9.5 8h5 M9.5 12h5',
  /* grid - the old launcher */
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  /* external link - leaves the app */
  out: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  /* docket - a work order */
  workorder: 'M5 3h10l4 4v14a0 0 0 0 1 0 0H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'
           + 'M15 3v4h4 M8 12h8 M8 16h5',
  /* machine - a rig */
  rig: 'M4 20h16 M7 20V9l5-5 5 5v11 M10 20v-5h4v5',
  /* people */
  people: 'M8 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M2.5 20a5.5 5.5 0 0 1 11 0'
        + 'M16 5.2a3.2 3.2 0 0 1 0 6.3 M17 14.8a5.5 5.5 0 0 1 4.5 5.2',
  /* book */
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z M5 17h13',
};

export const NAMES = Object.keys(P);

export function icon(name) {
  const d = P[name] || P.grid;
  return '<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">'
    + d.split('M').filter(Boolean).map(seg => '<path d="M' + seg + '"/>').join('')
    + '</svg></span>';
}
