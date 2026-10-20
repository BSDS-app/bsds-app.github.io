/* Fill in `firebase` once the project exists. Until firebase.apiKey has a
 * value the app runs in demo mode: no network, no real accounts, a role
 * switcher in place of the sign-in form. Everything else behaves the same,
 * which is the point - the screens you approve are the screens that ship.
 *
 * The Firebase web config is not a secret. It identifies the project; it does
 * not grant anything. firestore.rules is what grants.
 */
export const CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDGCSVhunOex6nncT0tQ_EsfCL8mu8GUzU',
    authDomain: 'bsds-app.firebaseapp.com',
    projectId: 'bsds-app',
    storageBucket: 'bsds-app.firebasestorage.app',
    messagingSenderId: '507015047525',
    appId: '1:507015047525:web:29c7fd93aa2e3278a3198c',
  },

  /* Workspace accounts sign in with Google; anything else is email and
   * password. Keep this list to the domains you actually own. */
  workspaceDomains: ['brokenspokedrilling.com'],

  /* The old BSDS Tools Launcher. The new app is a folder inside the same
   * GitHub Pages site, so these are plain relative links: /app/ is the new
   * door, / is the old one, and both reach the same tools.
   *
   * Clear `legacy.url` on the day the Launcher comes down. Until then, read
   * the warning in the README: the permission rules only bind this app, and
   * the Launcher has no login at all. */
  legacy: {
    url: 'https://bsds-app.github.io/',
    title: 'Old Launcher',
    blurb: 'The tools as they were, unchanged',
    tone: 'muted', icon: 'grid',
  },

  /* The tools, as they are deployed today. These are the pages themselves -
   * the Apps Script /exec addresses they talk to are listed under `backends`
   * below and are not needed until the data moves into Firestore.
   *
   * Written absolute rather than relative so the same config works from the
   * preview, from /app/ on the Pages site, and later from a custom domain. */
  /* How long safety paperwork is kept before it drops off by itself.
   *
   * 13 months, not 12. One year is what 30 CFR 56.18002(b) requires of a
   * workplace examination record; the extra month is so nothing disappears
   * the day it comes due, or in the middle of an audit.
   *
   * This is a floor, not a ceiling. A sheet with a defect on it that has not
   * been signed off as corrected is kept past this date regardless, because
   * 30 CFR 56.14100(d) runs on a different clock - the defect record is kept
   * "until the defects are corrected". And an owner can put a legal hold on
   * any record, which takes its expiry date off entirely.
   *
   * `formVersion` is the template a NEW sheet is filled on. Old records keep
   * the version they were signed on and render with that, which is the whole
   * point of versioning them: a 2026 record must not come back with rows
   * added in 2027. */
  retention: {
    preop: { days: 395, label: '13 months', formVersion: 1 },
    jsa:   { days: 395, label: '13 months', formVersion: 1 },
  },

  tools: {
    preop: {
      route: 'preop', title: 'Pre-Op Inspection', cap: 'preop.submit',
      tone: 'blue', icon: 'preop',
      blurb: 'Walk-around before the shift',
    },
    preopOld: {
      url: 'https://bsds-app.github.io/preop/', title: 'Pre-Op (old app)',
      cap: 'preop.submit', tone: 'muted', icon: 'preop',
      blurb: 'The spreadsheet version, until the changeover is finished',
    },
    jsa: {
      route: 'jsa', title: 'JSA', cap: 'jsa.submit',
      tone: 'orange', icon: 'jsa',
      blurb: 'Job safety analysis for the task',
    },
    jsaOld: {
      url: 'https://bsds-app.github.io/jsa/', title: 'JSA (old app)', cap: 'jsa.submit',
      tone: 'muted', icon: 'jsa',
      blurb: 'The spreadsheet version, until the changeover is finished',
    },
    receipts: {
      url: 'https://bsds-app.github.io/', title: 'Send a Receipt', cap: 'receipts.submit',
      tone: 'teal', icon: 'receipt',
      blurb: 'On the Launcher’s Receipts tab',
    },
    partsOrder: {
      route: 'parts', title: 'Order Parts', cap: 'parts.request',
      tone: 'blue', icon: 'parts',
      blurb: 'What the machine needs',
    },
    partsOld: {
      url: 'https://bsds-app.github.io/', title: 'Order Parts (old app)',
      cap: 'parts.request', tone: 'muted', icon: 'parts',
      blurb: 'The Launcher’s Parts Order tab, until the changeover is finished',
    },
    workorder: {
      route: 'wo', title: 'Work Order', cap: 'wo.request',
      tone: 'orange', icon: 'workorder',
      blurb: 'Somebody rang in a problem',
    },
    rebuild: {
      url: 'https://bsds-app.github.io/rebuild-forms.html', title: 'Parts Rebuild Order', cap: 'parts.order',
      tone: 'blue', icon: 'wrench',
      blurb: 'Bean pump, carousel, rotary head',
    },
    msha: {
      url: 'https://bsds-app.github.io/training-cert.html', title: 'MSHA 5000-23', cap: 'preop.submit',
      tone: 'teal', icon: 'cert',
      blurb: 'Certificate of training',
    },
    command: {
      url: 'https://bsds-app.github.io/owners.html', title: 'Command Center', cap: 'command.view',
      tone: 'navy', icon: 'command',
      blurb: 'Parts in motion, tasks, customers, numbers',
    },
    fullbay: {
      url: 'https://app.fullbay.com', title: 'Fullbay', cap: 'equipment.view',
      tone: 'teal', icon: 'out',
      blurb: 'Shop management and work orders',
    },
  },

  /* Where each tool actually writes. Nothing in the app calls these yet;
   * they are here so the migration into Firestore starts from the real
   * addresses rather than a hunt. */
  backends: {
    launcher: 'https://script.google.com/macros/s/AKfycbwjmAZSkwhOEIGp-bud90DRON14ibl3B7O0kwTfnpsxUxJ2T-jHQ769s3Y_ROyTPR3zow/exec',
    jsa:      'https://script.google.com/macros/s/AKfycbyXnbwAV-cdeBCsXY39P_mwIXg16Bs_dvKg1vW-ajCdEnawQsFbM9Ux19vyGkG7j7L3ZA/exec',
    preop:    'https://script.google.com/macros/s/AKfycbymsh02dEQ6jegenaG9sxXR84QhcZOT6uTD3xbq5ZEBZAOIDwfSeWQ5pzSFAtoXdsa4lA/exec',
  },

  /* Parts books already built. Each one is its own published page for now;
   * they move into the app's own storage in a later slice. */
  books: [
    { id: '70165', title: 'DM45-HP 70165',   serial: '70165', url: 'https://claude.ai/artifact/A1tDKMMPCXuqAUPhsgEKKq' },
    { id: '8619',  title: 'DM45 8619',       serial: '8619',  url: 'https://claude.ai/artifact/YDyGtjG6htgyDQWME5X9bi' },
    { id: '9453',  title: 'DM45 9453',       serial: '9453',  url: 'https://claude.ai/artifact/Unu64iuZK4qnQ1dtNECkQx' },
    { id: 'dr607', title: 'DR607 (s/n 7165)', serial: '7165', url: 'https://claude.ai/artifact/JPksgkjR7zG8aKvssYAaSZ' },
    { id: 'dr617', title: 'DR617 (s/n 47047)', serial: '47047', url: 'https://claude.ai/artifact/F8tC7dsXcpyWhoov6HRVU1' },
    { id: 'dr623', title: 'DR623 (s/n 58348)', serial: '58348', url: 'https://claude.ai/artifact/KJZsZ5bzH52Av5vLRpC2MX' },
    { id: 'd65',   title: 'D65',             serial: '',      url: 'https://claude.ai/artifact/Vqvf2VGQxpasjQyPvjShDF' },
  ],

  /* Reference shelves that are not per-machine. */
  shelves: [
    { title: 'D65 Schematics',        url: 'https://claude.ai/artifact/7tC9bCjwSvTYAyMoW7g2Xe' },
    { title: 'Epiroc Schematic Map',  url: 'https://claude.ai/artifact/4i8VSK5KQjNXshbm5yZP2V' },
    { title: 'Which Manual Does This Drill Take', url: 'https://claude.ai/artifact/LmRPUhJRWTtAsx4BksVtoj' },
    { title: 'DM45 / DM50 / DML Manual', url: 'https://claude.ai/artifact/84U4maMN3h9GC61rqf8NqU' },
    { title: 'DI550 Operations',      url: 'https://claude.ai/artifact/7RTRHgLv3eQQ8FB5ARCpbe' },
    { title: 'DI550 Maintenance',     url: 'https://claude.ai/artifact/GfGksfbPKMJA71k6Ms8Qnv' },
    { title: 'DI550 Technical',       url: 'https://claude.ai/artifact/YGmy3Sfdwf26b63xPKio86' },
    { title: 'Parts book library (Drive)',
      url: 'https://drive.google.com/drive/folders/1cgYEjScsFTapNGj84vv8UPjT_7G42CAh' },
  ],
};

export const DEMO = !CONFIG.firebase.apiKey;
