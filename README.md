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
- **iCal carries blocks, not rules.** A one-night gap between two stays arrives
  looking free, while the platform greys it out because the listing has a
  two-night minimum. `unbookableGaps()` closes any free run shorter than
  `MIN_STAY` that is walled in on both sides — leaving the open-ended run at the
  end of the horizon alone, which would otherwise close the entire future.

### The outbound feed

`/api/calendar.ics` publishes **only this site's own direct bookings**. It
deliberately does not re-publish dates read from Airbnb or Booking: feeding a
platform's own blocks back to it creates a loop those dates never escape.

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
netlify/functions/      availability · sync · blocks · rates · calendar.ics
netlify/lib/            ical · pricing · rates · store
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
