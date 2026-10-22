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
  /* Web push. The VAPID key is the public half of the key pair generated in
   * the Firebase console on 20 Oct 2026 (Project settings → Cloud
   * Messaging → Web Push certificates). Public by design - it identifies
   * the project to the push service and grants nothing. The private half
   * never leaves Google.
   *
   * `audience` is written here only so the app can SAY who gets what. The
   * sending itself is decided by the Cloud Function, which reads the roles
   * out of the database when it fires; this is a label, not a permission.
   */
  push: {
    vapidKey: 'BJkSMxw57dCMLNBcFHtv55wY87uyIbFWLO_zlD8PhIsa-EyNNAiemwvWVSr7hliYAsmhcgjwq-KHGjUYM2rPuZw',
    audience: {
      down: 'Mike and Stew',
      wo:   'the office and the owners',
    },
  },

  /* Receipts.
   *
   * `standingSOs` are the overhead service orders as they stand in Fullbay
   * (read off it 20 Oct 2026). They are listed here rather than exported
   * because they change about once a year, and they cover fuel, shop
   * supplies, training, small tools and every truck - which is most of
   * what anybody buys standing at a counter.
   *
   * `vendors` is a seed list for the type-ahead, taken from the vendors
   * already in the receipts log and on Fullbay purchase orders. Typing a
   * new name is still allowed; the list exists so that "Crus" and
   * "CRUS OIL INC." stop being two different companies.
   *
   * `alsoWriteSheet` keeps the old Receipts and Invoices spreadsheet fed
   * during the changeover. Turn it off the day the office works from the
   * worklist instead. */
  receipts: {
    alsoWriteSheet: true,
    standingSOs: [
      { so: '1519', label: 'Management approved' },
      { so: '1520', label: 'Shop supplies' },
      { so: '1521', label: 'Fuel — all trucks' },
      { so: '1522', label: 'Training' },
      { so: '1523', label: 'Small tools' },
      { so: '1524', label: 'Monthly expenses' },
      { so: '1551', label: "Clint's truck — 415" },
      { so: '1550', label: "Noah's truck — 272" },
      { so: '1552', label: "Stew's truck — 990" },
      { so: '1548', label: "Stew's truck — 998" },
      { so: '1553', label: 'F-750 — 490' },
      { so: '1565', label: 'Truck 820' },
    ],
    payments: [
      "Mike's Credit Card",
      "Stew's Credit Card",
      'Company Card',
      'Charge Account',
      'Cash',
    ],
    vendors: [
      '425 Manufacturing Inc', 'Arnold Machinery', 'CRUS OIL INC.',
      'DTS Fluid Power', 'Epiroc', 'GOOD 2 GO', 'Hose and Rubber',
      'Maverik', 'Mincon Inc.', 'Modern Machinery', 'NAPA',
      'Palmer Johnson Power Systems', 'Sandvik', 'Walmart',
      'Wheeler Machinery Co.',
    ],
  },

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
      route: 'receipt', title: 'Send a Receipt', cap: 'receipts.submit',
      tone: 'teal', icon: 'receipt',
      blurb: 'Photo, then what it was for',
    },
    receiptsOld: {
      url: 'https://bsds-app.github.io/', title: 'Send a Receipt (old app)',
      cap: 'receipts.submit', tone: 'muted', icon: 'receipt',
      blurb: 'The Launcher’s Receipts tab, until the changeover is finished',
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

  /* Parts books converted by hand earlier, as pages of their own. Once
   * tools/stage_books.mjs has put one in storage (it reads the id, title and
   * serial from here), the app opens the stored copy and this url is only
   * the fallback for a book not uploaded yet. Keep the id/title/serial on one
   * line each - the stage script reads them with a pattern. */
  books: [
    { id: '70165', title: 'DM45-HP 70165',   serial: '70165', url: 'https://claude.ai/artifact/A1tDKMMPCXuqAUPhsgEKKq' },
    { id: '8619',  title: 'DM45 8619',       serial: '8619',  url: 'https://claude.ai/artifact/YDyGtjG6htgyDQWME5X9bi' },
    { id: '9453',  title: 'DM45 9453',       serial: '9453',  url: 'https://claude.ai/artifact/Unu64iuZK4qnQ1dtNECkQx' },
    { id: 'dr607', title: 'DR607 (s/n 7165)', serial: '7165', url: 'https://claude.ai/artifact/JPksgkjR7zG8aKvssYAaSZ' },
    { id: 'dr617', title: 'DR617 (s/n 47047)', serial: '47047', url: 'https://claude.ai/artifact/F8tC7dsXcpyWhoov6HRVU1' },
    { id: 'dr623', title: 'DR623 (s/n 58348)', serial: '58348', url: 'https://claude.ai/artifact/KJZsZ5bzH52Av5vLRpC2MX' },
    { id: 'd65',   title: 'D65',             serial: '',      url: 'https://claude.ai/artifact/Vqvf2VGQxpasjQyPvjShDF' },
  ],

  /* Reference shelves that are not per-machine. Like the books above: once
   * tools/stage_books.mjs has put one in storage (from the folder of the same
   * id under bsds-books\shelves), the app opens the stored copy and the url is
   * only the fallback. Keep id and title on one line - the script reads them. */
  shelves: [
    { id: 'd65-schematics', title: 'D65 Schematics',        url: 'https://claude.ai/artifact/7tC9bCjwSvTYAyMoW7g2Xe' },
    { id: 'epiroc-schematic-map', title: 'Epiroc Schematic Map', url: 'https://claude.ai/artifact/4i8VSK5KQjNXshbm5yZP2V' },
    { id: 'which-manual', title: 'Which Manual Does This Drill Take', url: 'https://claude.ai/artifact/LmRPUhJRWTtAsx4BksVtoj' },
    { id: 'dm45-manual', title: 'DM45 / DM50 / DML Manual', url: 'https://claude.ai/artifact/84U4maMN3h9GC61rqf8NqU' },
    { id: 'di550-operations', title: 'DI550 Operations',     url: 'https://claude.ai/artifact/7RTRHgLv3eQQ8FB5ARCpbe' },
    { id: 'di550-maintenance', title: 'DI550 Maintenance',   url: 'https://claude.ai/artifact/GfGksfbPKMJA71k6Ms8Qnv' },
    { id: 'di550-technical', title: 'DI550 Technical',       url: 'https://claude.ai/artifact/YGmy3Sfdwf26b63xPKio86' },
    { title: 'Parts book library (Drive)',
      url: 'https://drive.google.com/drive/folders/1cgYEjScsFTapNGj84vv8UPjT_7G42CAh' },
  ],
};

export const DEMO = !CONFIG.firebase.apiKey;
