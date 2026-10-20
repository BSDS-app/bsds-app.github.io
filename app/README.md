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
| `fleet.js` | machines and customers — and the serial rule the parts books depend on |
| `parts.js` | parts requests, orders, and receiving |
| `alerts.js` | the band on the home screen: what is waiting on whoever just opened it |
| `icons.js` | the line icons on the tiles |
| `manifest.json` | what Add to Home Screen uses: the name, the logo, the navy |
| `forms/preop.v1.json` | the checklist itself — 7 equipment types, 179 lines, lifted verbatim off the old app |
| `forms/jsa.v1.json` | the JSA — 12 MSHA hazard categories, 3 conditional permits, 79 answerable items |
| `forms/build_*.py` | how those files were built, and the count gates that prove no line went missing |
| `seed/` | 15 customers and 77 rigs from the Fullbay export |
| `test/` | 160 shell, 259 Pre-Op, 164 JSA, 88 Parts, 73 Fleet, 48 People, 34 Alerts, 97 rule, 60 emulator checks |

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

Parts requests and orders are **not** on a retention clock. They are
purchasing records, not safety paperwork, and nothing requires them to be
destroyed.

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

## How it looks

The palette is the Launcher's, **sampled off it rather than guessed**: navy
`#1b3358` chrome, orange `#e8641c` accent, white panels on `#f5f6f8`, and the
four card colours the Launcher already uses to say what kind of thing a
button is — navy for owners-only, blue for field tools, orange for safety,
teal for reference and anything that leaves the app. Old-app tiles are
deliberately the quiet white ones.

Tiles carry drawn line icons rather than emoji, which render differently on
every phone and age badly. The set is small on purpose: an icon earns its
place while the tiles are telling things apart at a glance, and a different
picture on every button is just a second thing to read.

**Add to Home Screen** uses `manifest.json` and the site's existing
`icon-192.png` / `icon-512.png`, so the home-screen icon is the real logo and
no new artwork was needed. Those icons live one level above `/app/`, which is
where they really are in production — the test harness stands them in.

Dark mode keeps the navy chrome. It is the brand, not a light-mode choice.

---

## Forms that refuse

A refused form takes you to the first thing that is wrong, marks it, and
scrolls to it. Fix that one, press again, and it walks you down to the next.
It does not print a list at the bottom of a long page and leave you to hunt
for what it means — which is how a JSA that would not save got read as
"answering No is not allowed".

Two rules that came out of that:

- **Never print a field's label as if it were the error.** "What's the most
  dangerous task of your day?" is a question, not an instruction; the refusal
  has to say *answer this*.
- **Every refusal carries the field it is about.** `collect()` returns an
  `at` selector alongside the problems, and the form marks that element.

## Big enough to use

Nothing interactive is under **44px** tall — the number Apple and Google both
land on. A drill deck is not a desk and this gets used with gloves on, so
there is a test at phone width that fails if anything drops below it. For a
checkbox the hit area is its label, and the test measures that rather than
the box.

The page is drawn edge to edge (`viewport-fit=cover`), so the top bar pads
for the status bar and the notch, and long pages pad for the home indicator.
Without that the bar sits underneath the clock on an iPhone.

---

## What is waiting on you

The home screen carries a short band of things somebody has to act on, by
role. A rig down waiting on parts and a defect nobody has signed off are
drawn as stop-work; parts to order and serials to fill in sit quietly below
them. A tech sees only his own, and only while there is still something he
can do about it.

**It is only worth anything while it is short.** The test for adding a line
is not "would this be useful to know" — almost anything passes that — it is
*does somebody have to do something about this today, and will it stop being
here once they have?* A count that is never zero is decoration, and the first
line people learn to skip is the one that is there every single day. An empty
shop shows no band at all, and there is a test that fails if that stops being
true.

**It does not reach anybody.** The band appears when the app is opened and
not before. Sending a down rig to a phone needs something server-side, which
means the Blaze plan — see below. What that would send is exactly what
`alerts.gather()` already returns, so switching it on is a sender, not a
rewrite.

### Notifications on a phone, when you want them

Three things are needed, and none of them are code that exists yet:

1. **Blaze.** A phone cannot push to another phone; something server-side
   has to send it. One Cloud Function, triggered when a parts request is
   written with `urgency: 'down'`. The free allowance is about two million
   runs a month against a few dozen a day, so the cost is nothing — but the
   plan has to be on, and a budget alert set the same day.
2. **A service worker and a web app manifest**, plus a `fcmTokens`
   collection so each person's device can be reached, with a rule that a
   person may only write their own.
3. **On iPhones, Add to Home Screen.** Web push does not fire in a Safari
   tab — iOS 16.4 or newer, installed to the Home Screen, no workaround.
   Android works from the browser.

Scope it to **down rigs only**. Everything else sits in the band on purpose:
a phone that buzzes for every pre-op gets muted inside a week, and then the
one that mattered is muted too.

---

## Parts

Three states and nothing clever: **open** (a tech has asked, nobody has
bought it), **ordered** (it is on an order with a vendor and a PO against
it), **received** (it turned up). The tech watches his own request move
through them without having to ask anybody.

The request is the tech's record; the order is the office's. They are kept
apart on purpose — a request says *the rig needs this*, an order says *we
bought this, from them, on that PO*. Collapsing the two leaves you unable to
answer either "what is this rig waiting on" or "what did we actually buy last
month". An order copies the lines as they were when it was placed, so later
edits cannot rewrite what the record says was bought.

**A line with no part number is allowed, and flagged.** Half the time the tech
knows what the thing is and not what it is called, and forcing a number out of
him produces a *guessed* number — worse than a description and a lookup. The
queue counts how many need a number so the office knows there is looking-up to
do before anybody orders. There is a test whose only job is to fail if someone
later makes the part number required.

**Down is a fact, not a priority.** A rig that is not drilling is a different
kind of request from a shelf restock, so it sorts first, is counted on its own,
and nothing else competes with it.

Once a request is on an order the tech can no longer edit it — it has stopped
being a request and started being part of the record of what was bought. That
is in `firestore.rules`, not just the screen.

The three **rebuild sheets** (bean pump, carousel gearbox, 30' carousel) are
untouched. They are curated kit sheets with exploded views and Epiroc against
Buckhorn/FMC pricing — a different thing from a parts request, and they work.

---

## Machines and customers

Both are edited in the app. Owners keep the fleet; owners and office keep the
customer records — Jazmine can correct a customer's name without being able
to restructure the equipment list.

**The serial number is the key to the parts books**, which are laid out by
serial. So:

- **A duplicate serial is refused**, not warned about. Two machines sharing a
  serial means one of them opens the other's book, and a tech orders parts or
  works off a schematic for a different rig. The check ignores punctuation and
  case, so `9-4-5 3` will not sneak past `9453`.
- **The 14 machines with no serial are a worklist** on the front of the fleet
  screen, not something you notice by scrolling. Each one is a rig whose book
  cannot be matched until somebody reads the plate.
- A machine with no serial is otherwise perfectly normal. It just has no book.

**A machine that leaves the fleet is retired, never deleted** — same reason as
people. Pre-ops and JSAs filed against it still name it. Retired machines drop
off the working lists and still turn up in a search, marked.

**Renaming a customer writes one document.** Each machine carries its
customer's name as well as its id so the search can match on it, but that copy
is treated as a cache and refreshed from the customer record on every read.
The obvious implementation — rewrite the name onto every machine — would have
failed halfway for Jazmine, who may edit customers and may not write
equipment, leaving the two lists disagreeing with nothing to show for it.

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
node test/fleet.test.mjs      # machines and customers, and every way of getting a duplicate serial past it
node test/parts.test.mjs      # request to order to received, and the line with no part number
node test/alerts.test.mjs     # the home band, including that a quiet shop shows nothing
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
