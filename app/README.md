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
| `workorders.js` | work order requests, and the service order number coming back |
| `alerts.js` | the band on the home screen: what is waiting on whoever just opened it |
| `push.js`, `sw.js` | the half that reaches a phone when nobody has opened the app |
| `receipts.js` | receipts: the photo path unchanged, the coding and the office worklist new |
| `functions/index.js` | the sender. Two pushes, and the reason there are only two |
| `icons.js` | the line icons on the tiles |
| `manifest.json` | what Add to Home Screen uses: the name, the logo, the navy |
| `forms/preop.v1.json` | the checklist itself — 7 equipment types, 179 lines, lifted verbatim off the old app |
| `forms/jsa.v1.json` | the JSA — 12 MSHA hazard categories, 3 conditional permits, 79 answerable items |
| `forms/build_*.py` | how those files were built, and the count gates that prove no line went missing |
| `seed/` | 15 customers and 77 rigs from the Fullbay export |
| `test/` | 176 shell, 259 Pre-Op, 164 JSA, 88 Parts, 73 Fleet, 48 People, 34 Alerts, 74 Work Order, 66 Push, 56 Receipt, 132 rule, 92 emulator scenarios |

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

### Notifications on a phone

**Two things buzz. Everything else sits and waits for you.** That was the
instruction and it is the whole design:

| | Rings | |
|---|---|---|
| A rig down waiting on parts | Mike and Stew | A rig not drilling is costing money this hour |
| A work order rung in | the owners and the office | Somebody has to build it in Fullbay |

Parts to order, defects to sign off, a service order number coming back, a
machine with no serial — none of those buzz. They are on the band when you
open the app. A notification that arrives most days gets swiped away unread
by Friday, and the one that mattered goes with it.

**Each device is its own switch.** Turning it on on your phone does not turn
it on on your laptop. The Notifications screen lists the devices currently
being rung, so a phone in a drawer can be switched off.

**On an iPhone it only works once the app is on the home screen.** Share →
Add to Home Screen, open it from there, then turn notifications on. In a
Safari tab there is nothing to turn on — that is Apple's rule and there is
no way round it. The app detects that case and says so rather than showing a
button that cannot work.

**Tapping one lands you on the thing it told you about** — the parts queue or
the work order list — not on the home screen to go and find it.

Three things worth knowing about how it is built:

- `sw.js` carries a **second copy** of the Firebase project config, because a
  service worker cannot import a module. `test/push.test.mjs` compares every
  value against `config.js` and fails if they ever drift.
- The **audience is read, not copied.** The sender looks the roles up in the
  database at the moment it sends, so a role changed a minute ago is already
  in force. Stamping the role onto the token row would be cheaper and would
  go stale on the day it mattered.
- **A failed push never undoes the write.** The request is saved first; the
  buzz is best-effort. Losing the record would be a real problem, losing the
  buzz is an inconvenience.

Nobody can read anybody else's push tokens — not office, not an owner. A
list of who is carrying which phone is not something this app needs to be
able to produce.

### Budget alert

Blaze is metered. The notification side runs a couple of dozen function
invocations a day against a free allowance of about two million a month, so
the real bill is nothing — but "nothing" is a statement about today's usage,
not a guarantee. Set a budget alert in the Google Cloud billing console the
same week you turn Blaze on, and treat any month that trips it as a bug to
go and find rather than an invoice to pay.

---

## Receipts

**The photo path is unchanged.** It still goes to the same Apps Script
backend that has always written it to the same Drive folder — and that
backend already reads the receipt with Claude and hands back the vendor,
invoice number, date and amount. None of that was rebuilt. Jazmine keeps
working out of the accounting folder exactly as before.

What is new is the coding on top of it.

**The service order is picked, not typed.** The old log has `Tr990`,
`820 fuel` and `Management approved` in its work order column. Every one of
those is a real Fullbay service order that somebody could not put a number
to while standing at a parts counter. That is not carelessness, it is a
missing picker — so there is one now, covering fuel, shop supplies, small
tools, training and every truck without needing any export at all.

**A receipt can be split across several jobs, and the split must add up.**
One card swipe for a part and a tin of shop supplies is two different
jobs, and Fullbay structurally cannot say so: one purchase order belongs to
one service order. Lumping it either overcharges the customer or quietly
eats the shop supply recovery. The form shows what is still unaccounted for
as you type, and refuses a receipt whose lines do not come to the total —
including a penny out, which is the version nobody finds until the books
are being closed.

**There is no "paid" field, on purpose.** Payment lives in QuickBooks and
Melio. The old sheet had one and nobody ever updated it — its own
due-date formula reads `#N/A` as a result. That is what an unowned
duplicate looks like from the inside.

**The office gets a worklist, not a pile.** Everything needed to raise the
purchase order and the bill is on one row with the image beside it, and
marking it entered records the Fullbay PO number. That number is the join
key that later answers *which purchase orders have no receipt against
them* — a question nothing can answer today, which is why every Attachments
column in Fullbay reads 0.

**During the changeover the old spreadsheet still gets its row.** That is
deliberate duplication with an owner and an end date: turn off
`receipts.alsoWriteSheet` in `config.js` the day the office works from the
worklist instead. A split cannot be written to that sheet — it has one work
order column — so the cell says `SPLIT` and lists the service orders, which
is true and visible rather than silently recording a part as the whole.

A tech sends receipts in and reads none of them back — not the log, not the
images. That was a hard rule before any of this was built, and it is
enforced in `firestore.rules`, not just on the screen.

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

## Work orders

A customer rings. Somebody raises it. The office builds it in Fullbay and the
**service order number comes back to whoever raised it** — on his own home
screen, without a second phone call in the other direction. That round trip
is the whole feature; everything else on the screen is in service of it.

Required: customer, location, unit or serial, the complaint, who called.
**Not** required: the PO number and the assigned tech. A PO is often not known
when the phone rings, and who goes is the office's call, not the caller's.
Making either one mandatory just teaches people to type something false into
it.

The complaint is free text and stays free text. Nobody rings up with a part
number; they ring up and say the compressor is making a noise. Their words
beat a tidy summary, and beat a dropdown by a mile.

Three states: **open** (raised, not built), **built** (it exists in Fullbay
and carries a service order number), **cancelled**. A tech can correct his own
while it is still open and can never write the number or move the status —
a number a tech can type is a number the office cannot trust. That is in
`firestore.rules`, not just the screen.

A tech sees the work orders he raised, plus any he has been assigned.
Assigning stamps the tech's **id** as well as his name, which is what makes
it land on his screen — so Jazmine can hand a job to Noah without ringing
him. That works because **office can read the roster**, which you decided in
October 2026.

Reading the roster is not running it. Office can see who the techs are and
nothing else about people: no setting a role, no switching anybody off, no
inviting anybody, and no sight of who is being hired. There is no People
button on her screen at all. The personnel file is a separate collection and
is still owners-only — Mike and Stew. Both halves of that line are tested,
in the rules and on the screen.

The assign field stays a type-in box with the roster behind it rather than a
dropdown, so the office can still put down a name that is not on the list — a
new hire, a contractor — and the assignment is kept either way. Picking a
real tech is what stamps the id.

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
node test/workorders.test.mjs # a tech rings one in, the office builds it, the number comes back
node test/push.test.mjs       # the two notifications, and the files that have to agree about them
node test/receipts.test.mjs   # the coding, and the split that has to add up
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

That one is the real proof — **92 named scenarios holding 146 assertions**, run
against a real database rather than against the app. (An earlier version of
this file said 227 checks; that was a miscount of `await` lines.) It starts a
Firestore, signs in as a tech, and
tries to read the master log, the receipts, somebody else's JSA and the
personnel file — and fails if any of them come back. It also checks a tech
cannot promote themselves, cannot write a service order number onto his own
work order, and that an account switched off gets nothing.

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
