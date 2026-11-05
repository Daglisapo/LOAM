# LOAM — short-let site, guest guide and availability engine

Production site for a short-let apartment in central Thessaloniki:
**[loamskg.gr](https://loamskg.gr)**

It is three things sharing one deployment — a public listing page, a private
guest guide, and a calendar that merges Airbnb and Booking.com availability and
prices direct bookings against it.

No framework, no build pipeline beyond a 40-line script, no client-side
dependencies. Static HTML with a handful of serverless functions.

---

## Why it exists

Airbnb and Booking each take 15–18% commission. A direct booking keeps that
money, but only if the guest can see real availability and a real price without
waiting for a reply. That is the whole problem this repository solves.

The hard part is not the calendar. It is that **neither platform gives an
individual host API access** — that is reserved for certified channel-manager
partners. All a host gets is an iCal feed, polled every few hours. So the design
works within that constraint deliberately, and is honest about where it cannot
reach.

---

## Architecture

```
Airbnb  .ics ─┐
              ├─→ sync (cron, 5 min) ─→ Netlify Blobs ─→ /api/availability ─→ site calendar
Booking .ics ─┘                              ↑                                    │
                                             │                                    ↓
                          owner calendar ────┘                          booking request form
                          (blocks + prices)                                (Netlify Forms)
                                             │
                                             └──→ /api/calendar.ics ─→ imported by both OTAs
```

### Availability

`netlify/lib/ical.mjs` parses both feeds. Two details matter more than they look:

- **`DTEND` is exclusive.** A stay of 10–14 March blocks the nights of the 10th
  to the 13th; the 14th is a checkout and stays bookable. Getting this wrong
  loses a sellable night on every single booking.
- **iCal carries blocks, not rules.** A two-night hole between two stays at
  Christmas, where the minimum is three, arrives looking like any free night.
  Closing such holes hid nights both platforms still show as free, so
  `shortRuns()` finds them instead and the hole's minimum shrinks to its length:
  bookable, but only whole. Only runs walled in on both sides count — the
  open-ended run at the end of the horizon is left alone.

### The outbound feed

`/api/calendar.ics` publishes **only this site's own direct bookings**. It
deliberately does not re-publish dates read from Airbnb or Booking: feeding a
platform's own blocks back to it creates a loop those dates never escape.

### The owner's calendar

`/api/owner-calendar.ics` is a second, private feed for the owner's phone: every
stay from all three sources, with the guest's details on direct bookings. Two
stays on one night are a real conflict and both appear; Airbnb's closed dates
only fill nights no stay claims, since Airbnb also closes the current day. The
owner page's month grid is drawn from the same list, so each check-out day can
show the leaving guest until 11:00. A calendar app cannot send a header, so its secret is a random
token in the URL, stored in Blobs and replaceable from the owner page. If a
platform feed is failing it answers 503, so the phone keeps its last good copy
rather than losing those stays.

### The books

The owner page has a second tab, *Κρατήσεις & Οικονομικά*: every stay, what it
earned, and what each month cost, with charts. Neither platform gives a host an
API, so `netlify/lib/ledger.mjs` fills it from three sides:

- **the feeds** — the sync job records each stay as it appears, with Airbnb's
  confirmation code read from the event description. Platforms drop past stays
  from their feeds; the ledger keeps them. A future stay that leaves a feed that
  answered is marked cancelled.
- **the exports** — Airbnb's transaction-history CSV and Booking's payment
  statement CSV, uploaded on the page, previewed, then merged on confirmation
  code or check-in date. Booking ships its file double-encoded; the reader
  repairs it. Importing the same file twice changes nothing.
- **the owner** — tax number, passport, a corrected check-out for a guest who
  left early. Those corrections survive later imports.

Money is spread over a stay's nights, so a stay across a month boundary counts
in both. ΤΑΚΚ (the climate resilience fee) is charged per night by season and
the income tax is an estimate on the rental scale; both rates are settings,
since they change by law. The ledger is read with errors thrown, not swallowed:
an empty ledger saved over a real one would erase its history.

### Pricing

`netlify/lib/pricing.mjs` is pure — no storage, no platform — so it can be tested
with `node`. A stay is priced night by night, so one that straddles a seasonal
boundary is charged correctly rather than flattened to a single rate. Extra
guests beyond `includedGuests` are charged per person per night.

The owner sets rates by dragging across the calendar, the way Airbnb does.

### What it will not do

It cannot push a direct booking into Airbnb or Booking in real time. It publishes
an iCal feed and waits for them to poll it, which takes a few hours. That window
is why the public form takes **booking requests** the owner confirms by hand,
rather than instant bookings — a confirmed-by-hand request cannot double-book;
an instant one can. Closing that gap properly needs a channel manager with real
API credentials.

---

## Layout

```
index.html              public listing page — 5 languages, gallery, calendar, request form
src/guide.html          guest guide — arrival, house, videos, rules, neighbourhood
src/admin.html          owner calendar — merged availability, blocks, pricing
build.mjs               writes the two private pages to their secret paths
netlify/functions/      availability · sync · blocks · rates · ledger · calendar.ics · owner-calendar.ics
netlify/lib/            ical · ledger · ownerfeed · pricing · rates · store
assets/                 photographs and the three guide videos
```

`src/guide.html` and `src/admin.html` are served from unguessable URLs, so those
paths are environment variables rather than folder names in the repository.
`build.mjs` writes them at deploy time into `g/$GUEST_SLUG/` and `a/$ADMIN_SLUG/`,
both git-ignored. `netlify.toml` adds `X-Robots-Tag: noindex` on those prefixes —
`robots.txt` is a request, a header is enforcement.

---

## Internationalisation

Every string sits in one `TR` object keyed by phrase and language
(`en · el · de · fr · it`). Elements carry `data-i18n`; `setLang()` swaps
`textContent` and stores the choice. First visit follows `navigator.language`.

The guest guide uses the same idea with parallel arrays instead of a map, since
it renders from a single data structure.

---

## Running it

```bash
npm install
node build.mjs          # writes preview copies; warns about missing variables
npx netlify-cli dev     # functions need the Netlify runtime for Blobs
```

The pure logic runs without any of that:

```bash
node --check index.html    # after extracting the inline script
node test/pricing.test.mjs
```

Copy `.env.example` to `.env` for local values. Nothing secret is committed:
no passwords, no feed tokens, no private URLs.

---

## Notes

- **Netlify creates new projects with SSO required.** The deploy reports success
  and the site returns 401 to everyone. It has to be turned off explicitly.
- **Netlify Forms is off by default,** and form detection happens at deploy time.
  A form can render perfectly and silently discard every submission until the
  feature is enabled and the site redeployed.
- Photos are served as JPEG at fixed widths. The first version inlined them as
  base64 in the HTML — 3.1 MB for one page, uncacheable. Extracting them brought
  the document to 36 KB.

## Licence

Code is MIT. Photographs and the LOAM name are not — please do not reuse them.
