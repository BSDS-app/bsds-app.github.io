/* The permission matrix. One source of truth.
 *
 * The UI reads this to decide what to show. firestore.rules enforces the same
 * thing on the server, because hiding a button is not security - anyone can
 * open the console. If you change a capability here, change it there too; the
 * test suite checks the two agree.
 */

export const ROLES = {
  owner: {
    label: 'Owner',
    who: 'Mike and Stew',
    note: 'Everything, including personnel.',
  },
  office: {
    label: 'Office',
    who: 'Jazmine',
    note: 'Payables, receivables, invoicing and the logs behind them. No personnel files.',
  },
  tech: {
    label: 'Technician',
    who: 'Field and shop techs',
    note: 'Submits work and looks things up. Cannot read the master logs, '
        + 'receipt images, or anyone else’s JSAs.',
  },
  customer: {
    label: 'Customer',
    who: 'Phase 2 - not switched on yet',
    note: 'Their own machines only: parts books, a service request, a parts order.',
    disabled: true,
  },
};

/* Every capability in the app, grouped the way a person would explain them. */
export const CAPS = {
  'preop.submit':    'Fill in a pre-op inspection',
  'preop.log':       'Read the pre-op master log',
  'preop.correct':   'Sign a defect off as corrected',
  'preop.hold':      'Put a legal hold on a record so it is never purged',
  'jsa.submit':      'Fill in a JSA',
  'jsa.own':         'Read back JSAs you filed yourself',
  'jsa.log':         'Read every JSA on file',
  'jsa.hold':        'Put a legal hold on a JSA so it is never purged',
  'receipts.submit': 'Send in a receipt or invoice',
  'receipts.images': 'Open the receipt images',
  'receipts.log':    'Read the receipts and invoices log',
  'parts.request':   'Request parts',
  'parts.order':     'Approve and build a parts order',
  'wo.request':      'Ring in a work order request',
  'wo.manage':       'Work the work order list and raise the service order',
  'books.view':      'Open the parts books and schematics',
  'equipment.view':  'See customers, rigs and serial numbers',
  'equipment.edit':  'Change the equipment list',
  'customers.edit':  'Change customer records',
  'reports.view':    'Shop reports, AR aging, job costs',
  'command.view':    'Open the Command Center',
  'hr.view':         'Personnel files',
  'users.read':      'See who is on the app and what they are',
  'users.manage':    'Add people and set what they can see',
};

/* Who gets what. Owner is deliberately written out in full rather than
 * given a wildcard, so the matrix can be read straight down a column. */
export const GRANTS = {
  tech: [
    'preop.submit', 'jsa.submit', 'jsa.own', 'receipts.submit',
    'parts.request', 'wo.request', 'books.view', 'equipment.view',
  ],
  office: [
    'preop.submit', 'preop.log', 'preop.correct',
    'jsa.submit', 'jsa.own', 'jsa.log',
    'receipts.submit', 'receipts.images', 'receipts.log',
    'parts.request', 'parts.order', 'wo.manage', 'books.view',
    'equipment.view', 'customers.edit', 'reports.view', 'users.read',
  ],
  owner: [
    'preop.submit', 'preop.log', 'preop.correct', 'preop.hold',
    'jsa.submit', 'jsa.own', 'jsa.log', 'jsa.hold',
    'receipts.submit', 'receipts.images', 'receipts.log',
    'parts.request', 'parts.order', 'wo.request', 'wo.manage', 'books.view',
    'equipment.view', 'equipment.edit', 'customers.edit', 'reports.view',
    'command.view', 'hr.view', 'users.read', 'users.manage',
  ],
  customer: ['books.view', 'parts.request'],
};

export function can(role, cap) {
  return (GRANTS[role] || []).indexOf(cap) >= 0;
}

/* The things that must never be true, whatever else changes. The test suite
 * asserts every one of these against GRANTS, against firestore.rules, and
 * against what the app actually draws. Adding a rule here is how you make it
 * stick; nothing else in the codebase is allowed to contradict it. */
export const HARD_RULES = [
  { role: 'tech',   cap: 'preop.log',       why: 'techs must not read the master logs' },
  { role: 'tech',   cap: 'preop.correct',   why: 'a tech does not sign off his own defect' },
  { role: 'tech',   cap: 'preop.hold',      why: 'a legal hold is Mike and Stew only' },
  { role: 'office', cap: 'preop.hold',      why: 'a legal hold is Mike and Stew only' },
  { role: 'tech',   cap: 'jsa.hold',        why: 'a legal hold is Mike and Stew only' },
  { role: 'office', cap: 'jsa.hold',        why: 'a legal hold is Mike and Stew only' },
  { role: 'tech',   cap: 'receipts.images', why: 'techs must not open receipt images' },
  { role: 'tech',   cap: 'jsa.log',         why: 'techs must not read the JSA archive' },
  { role: 'tech',   cap: 'hr.view',         why: 'personnel is owners-only' },
  { role: 'office', cap: 'hr.view',         why: 'personnel is owners-only' },
  { role: 'tech',   cap: 'command.view',   why: 'the Command Center is Mike and Stew only' },
  { role: 'office', cap: 'command.view',   why: 'the Command Center is Mike and Stew only' },
  { role: 'tech',   cap: 'wo.manage',       why: 'the service order number is the office\u2019s to write' },
];
