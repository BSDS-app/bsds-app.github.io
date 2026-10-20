# Broken Spoke — Phase 1

The login and role shell. Everything else in the app hangs off this, so it is
built first.

It runs **beside** the existing BSDS Tools Launcher, not instead of it.

The Launcher turns out to be a plain static site on GitHub Pages — the
Apps Script projects are backends it calls, not pages it is served from — so
the new app is simply another folder in the same repo:

```
bsds-app.github.io/              the Launcher, untouched
bsds-app.github.io/preop/        Pre-Op Inspection App
bsds-app.github.io/jsa/          JSA
bsds-app.github.io/owners.html   Command Center
bsds-app.github.io/app/   <--    this
```

Both doors reach the same tools and write to the same spreadsheets. One
`git push` puts the new app up without touching a line of the old one, and
Firebase is needed only for **sign-in**, not for hosting. Nothing is cut over
until you say so — see *While both are up* below, which includes the one
thing that is genuinely weaker while two doors are open.

Four kinds of account. Mike and Stew are **owners** and see everything.
Jazmine is **office**: payables, receivables, the logs behind them, no
personnel. Techs **submit work and look things up** — they never read the
master logs, the receipt images, or anyone else's JSAs. **Customers** are
defined but switched off until Phase 2.

Two files decide all of it: `roles.js` for what the app draws, and
`firestore.rules` for what the database will actually hand out. They have to
agree, and `test/rules.static.mjs` fails the build if they drift. Hiding a
button is not security — anybody can open the browser console.

---

## What is here

| | |
|---|---|
| `index.html`, `app.css`, `app.js` | the shell |
| `auth.js` | sign-in, and the one question — who is this and what may they see |
| `config.js` | Firebase keys, the Apps Script URLs, the parts books, the retention periods |
| `roles.js` | the permission matrix |
| `firestore.rules`, `storage.rules` | the same matrix, enforced server-side |
| `preop.js` | the Pre-Op form: filling one in, storing it, reading it back as the sheet |
| `jsa.js` | the JSA, the same way — including the three permits it can open |
| `retention.js` | how long a record is kept and what stops it being deleted. One copy, shared |
| `people.js` | who is on the app: invitations, roles, switching somebody off |
| `forms/preop.v1.json` | the checklist itself — 7 equipment types, 179 lines, lifted verbatim off the old app |
| `forms/jsa.v1.json` | the JSA — 12 MSHA hazard categories, 3 conditional permits, 79 answerable items |
| `forms/build_*.py` | how those files were built, and the count gates that prove no line went missing |
| `seed/` | 15 customers and 77 rigs from the Fullbay export |
| `test/` | 160 shell, 259 Pre-Op, 149 JSA, 48 People, 89 rule, 52 emulator checks |

Until `config.js` has a Firebase key the app runs in **demo mode**: a person
picker instead of a sign-in form, no network, nothing written. The screens are
the same ones that ship.

---

## Standing it up

**Done already, in the console (19 Oct 2026):**

- Project `bsds-app`, project number 507015047525, under the
  brokenspokedrilling.com org. Still on the **Spark (free)** plan, which is
  enough for Phase 1 — Auth and Firestore both run on it, and 50k reads and
  20k writes a day is far above six people filling in forms. Blaze is only
  needed later, for Cloud Storage and scheduled backups.
- Web app **BSDS App** registered; its config is in `config.js`.
- **Email/Password** sign-in on (techs). Email-link passwordless left off.
- **Google** sign-in on (the Workspace accounts). The consent screen reads
  "Broken Spoke Drilling Solutions", support address mike@.
- **bsds-app.github.io** added to the authorized domains, so sign-in works
  from the Pages site.
- **Firestore created in us-west3 (Salt Lake City)**, in *production mode* —
  which means everything is denied until the rules below are published. That
  region is permanent.

**Left to do, in this order:**

**1. Publish the rules.** Until this runs, the database refuses everything
and the app will sign you in to a blank screen. From the repo:

```
npm install -g firebase-tools
firebase login
firebase use bsds-app
firebase deploy --only firestore:rules
```

Do it this way rather than pasting into the console — the rules are a file in
the repo, so they are versioned and a later change is a diff rather than a
mystery.

**2. Deploy the app.** Copy this folder into the `bsds-app.github.io` repo as
`app/`, commit, push. Pages serves it at `bsds-app.github.io/app/` within a
minute. The Launcher is not touched.

**3. Make yourself an owner.** Done. This is the only account that ever has
to be created by hand: Firestore → `users` → document ID = your UID from
Authentication → Users, with `name`, `role: owner`, `active: true`.

**Everybody after you is added from the People screen** — see *Adding people*
below. Nobody needs the console again.

**4. Load the equipment.** `seed/customers.json` and `seed/equipment.json`
import into the `customers` and `equipment` collections. A machine with no
serial on the Fullbay record stays blank on purpose — the books are laid out
by serial, and a guess there is the one mistake that is not recoverable.

**5. Run the emulator test** before real data goes in — see *Checking it*.

**6. Turn the purge on.** Pre-ops carry an `expiresAt` date — 13 months out,
or empty while a defect is open or a legal hold is on. Nothing deletes them
until a Firestore **TTL policy** exists on that field. Two policies, one per
collection. In the Google Cloud console, Firestore → Time-to-live → Create
policy, collection group `preops`, timestamp field `expiresAt`, then the same
again for `jsas`. Or:

```
gcloud firestore fields ttls update expiresAt \
  --collection-group=preops --enable-ttl --project=bsds-app
gcloud firestore fields ttls update expiresAt \
  --collection-group=jsas --enable-ttl --project=bsds-app
```

A document whose `expiresAt` is empty or null is skipped, which is exactly
what a legal hold and an uncorrected defect leave it as. Deletion happens
within about 24 hours of the date, and each deleted document is billed as one
write — a few hundred a year is nothing. **Until this policy exists nothing
is deleted at all**, which is the safe way round: records pile up rather than
disappear, and the app still shows you what is due to drop.

---

## How long things are kept

`CONFIG.retention` in `config.js`, currently **13 months** for pre-ops and
JSAs. One year is what 30 CFR 56.18002(b) requires of a workplace examination
record; the extra month is so nothing vanishes the day it comes due.

Two things override it on a pre-op, and both are deliberate:

- **An uncorrected defect.** 30 CFR 56.14100(d) keeps a defect record "until
  the defects are corrected" — a different clock from the one-year
  examination record. A sheet with a fail on it that nobody has signed off
  has no expiry date at all. Signing the last one off is what starts the
  clock, and the clock then runs from the correction, not from the
  inspection.
- **A legal hold.** Owners only. Put one on a sheet that is evidence in an
  incident, a citation contest or a customer dispute. It clears the expiry
  date, so the purge has nothing to read. An auto-delete that cannot be
  stopped is a liability, not a feature.

A JSA has only the second of those. A YES on a hazard category is the JSA
doing its job, not an open item, so nothing about a JSA's own content keeps
it open — only a hold. And because a JSA carries no MSHA clock of its own,
its 13 months is a house rule rather than a legal floor; it matches the
pre-ops so there is one answer to the question.

Both are visible on the record and counted on the log, so nothing is quietly
being kept or quietly being dropped.

---

## Adding people

Three steps, and only the first one is yours:

1. **People → Add somebody.** A name, an email address, a role. That writes
   an *invitation*, not an account.
2. **They open the app.** A brokenspokedrilling.com address signs in with
   Google. Anybody else taps **First time here** and sets their own password.
3. **The app turns the invitation into their record** on that first sign-in,
   at the role the invitation named, and clears the invitation.

Setting a password is not the same as being admitted. An account with no
`users` record is shown the not-admitted screen and the database hands it
nothing, so a stranger who finds the address and makes an account gets as far
as the door and no further. What admits somebody is the invitation, and only
an owner can write one.

**Leaving is switching off, never deleting.** Their pre-ops and JSAs point
back at their record; delete it and a signed sheet becomes paperwork nobody
filed. Switching off is instant and reversible.

**An owner cannot change their own role or switch themselves off.** Not a
courtesy — it is the rule that means no sequence of clicks leaves the company
locked out of its own app. Mike can demote Stew and Stew can demote Mike;
neither can do it to himself. It is enforced in `firestore.rules`, not just
hidden on the screen, and `test/rules.test.mjs` tries it four ways.

---

## While both are up

Read this once. **The permission rules only bind the new app.**

The Launcher has no sign-in at all — anyone with that address reaches the
same tools with no role attached, **the Command Center page included**. So
for as long as both are running, a tech who keeps using the old bookmark is
in exactly the position he was in before: the master logs, the receipts, the
JSA data and `owners.html` are only as private as the Launcher ever made
them.

That is not an argument against running them side by side. It is the right
way to move, and the app says so on the Permissions screen rather than
pretending otherwise. It is an argument for the Launcher coming down on a
date rather than drifting.

**Suggested order.** Put yourself and Stew on the new app first. Add Jazmine
once the receipts tile works end to end. Move one tech — Clint — and leave
him there for a week. If nothing bites, move the rest, then retire the
Launcher.

**Retiring it, when you get there.** Replace `index.html` at the repo root
with a redirect to `/app/`, leave it up for a month so old bookmarks land
somewhere, then clear `legacy.url` in `config.js`. The Old Launcher tile
disappears and so does the open-door warning on the Permissions screen —
there is a test that checks both go together, so it cannot be half done.

---

## Checking it

```
node test/app.test.mjs        # the shell, as each role, at phone and desktop width
node test/preop.test.mjs      # the Pre-Op form: every line, every role, the retention rules
node test/jsa.test.mjs        # the JSA: the hazard review, and the permits it refuses to skip
node test/people.test.mjs     # roles, invitations, and the owner who cannot lock himself out
node test/rules.static.mjs    # roles.js and firestore.rules still agree
```

`preop.test.mjs` counts the checklist three times — in the template, in the
drawn form, and in the saved record — for all seven equipment types, and
fails if any two disagree. A form that quietly files 25 of 26 lines looks
exactly like a form that works, which is why it is counted rather than
eyeballed.

`jsa.test.mjs` asks a different question. Most of it is one scenario: answer
YES to confined space, fill in everything else properly, and try to file. It
must be refused, and refused by name — the missing oxygen reading, the
missing attendant, the unconfirmed rescue equipment. A JSA that lets a man
sign off on an entry he has not planned is worse than no JSA, so that refusal
is tested rather than trusted.

Both of those run anywhere. The third one needs a download this build
environment is not allowed to make, so **run it once on your machine before
you put real data in**:

```
npx firebase emulators:exec --only firestore "node test/rules.test.mjs"
```

That one is the real proof. It starts a Firestore, signs in as a tech, and
tries to read the master log, the receipts, somebody else's JSA and the
personnel file — and fails if any of them come back. It also checks a tech
cannot promote themselves, and that an account switched off gets nothing.

---

## Not in this slice

**Receipts stay as they are, on purpose.** The photo keeps landing in the
Drive folder and Jazmine keeps working out of the accounting folder. That
workflow is not broken and moving it would break it.

The old Pre-Op and JSA apps are still up and still linked from the tiles, so
nothing is stranded mid-changeover. They write to their own spreadsheets; the
new ones write to Firestore. Nothing reconciles the two, so pick one per
machine per shift rather than filing the same paperwork twice.

The parts books still open as separate pages; they move into Storage next — the 70165 book already serves its 294 drawings as separate files, which
is the shape they need to be in.
