# Architecture

## Shape

```
┌─────────────────────────────────────────────────────────────┐
│ Raspberry Pi                                                │
│                                                             │
│  Chromium (kiosk) ──► React SPA ──┐                         │
│                                   │ polls /api/agenda       │
│                                   ▼                         │
│                          ┌──────────────────┐               │
│                          │  Express (TS)    │               │
│                          │  · REST API      │               │
│                          │  · serves SPA    │               │
│                          │  · sync worker   │               │
│                          └────────┬─────────┘               │
│                                   │                         │
│                          ┌────────▼─────────┐               │
│                          │ SQLite (WAL)     │               │
│                          └──────────────────┘               │
│                                                             │
│  [future] camera ──► detector ──► POST /api/presence/…      │
└─────────────────────────────────┬───────────────────────────┘
                                  │ HTTPS, every 15 min
                     ┌────────────┴────────────┐
                     ▼                         ▼
              iCloud published          SportsEngine
              calendar (ICS)            team calendar (ICS)
```

One Node process does everything: HTTP API, static hosting for the SPA, and the
background feed poller. On a device with 512 MB–4 GB of RAM, separate processes
would cost more than they buy.

## Repository layout

```
piCalendar/
├── packages/shared/          # wire types + zod schemas, used by both sides
├── apps/backend/
│   ├── src/config/           # env parsing (zod); fails fast on bad config
│   ├── src/db/
│   │   ├── migrations/       # forward-only .sql
│   │   └── repositories/     # all SQL lives here, nowhere else
│   ├── src/ingest/           # fetch → parse → adapt → reconcile → schedule
│   ├── src/routes/           # thin HTTP layer over the repositories
│   └── test/
├── apps/frontend/
│   ├── src/pages/            # DashboardPage, AdminPage
│   ├── src/components/       # DayColumn, EventCard, FeedForm, PeoplePanel
│   └── src/hooks/            # usePolling, useClock
├── deploy/                   # systemd unit, install script, kiosk notes
├── docs/
└── .github/workflows/        # ci.yml, deploy.yml
```

`@picalendar/shared` is the contract. A zod schema defined there validates the
request on the server _and_ types the form on the client, so the two cannot
drift apart silently.

## Ingestion

```
listDueFeeds()                     each feed carries its own refresh interval
  └─ fetchIcs()                    conditional GET (ETag / If-Modified-Since)
       ├─ 304 ──────────────────►  done, no parsing
       ├─ body hash unchanged ──►  done, no parsing
       └─ parseIcs()               node-ical + rrule
            └─ applyAdapter()      per-provider clean-up
                 └─ replaceFeedEvents()
                      ├─ hash unchanged  → touch sync token only
                      ├─ hash changed    → upsert + re-expand occurrences
                      └─ token mismatch  → delete (source dropped it)
```

Three layers of "do nothing if nothing changed": HTTP validators, a body hash,
and a per-event content hash. A steady-state sync of a dozen calendars performs
a dozen 304s and zero writes — which is what keeps SD-card wear down.

The scheduler is a single timer. Each tick asks the database which feeds are
due, so per-feed cadence is data rather than a timer per feed. Ticks cannot
overlap; a slow sync delays the next one instead of stacking up. Feeds sync
serially, keeping peak memory at one ICS document however many are configured.

## Recurrence and timezones

The one genuinely hard part of a calendar app.

`rrule` rewrites its results relative to the **process** timezone when the rule
carries a `tzid`, which would make expansion depend on how the Pi's clock is
configured. So the rule is rebuilt without a `tzid`, yielding _floating_
instances — dates whose UTC fields spell the intended wall-clock reading — and
those are anchored into the event's own zone here.

That is what holds a 19:00 practice at 19:00 across a daylight-saving change
instead of sliding it by an hour. `apps/backend/test/parser.test.ts` pins it,
and CI runs the whole suite under four process timezones so a regression cannot
hide behind a UTC runner.

All-day values need the opposite treatment: `node-ical` constructs them at
_local_ midnight, so their calendar date is read with local getters and
re-anchored to midnight in `DISPLAY_TIMEZONE`.

## The dashboard's read path

`GET /api/agenda?days=8` is the only query that runs continuously:

```sql
SELECT … FROM event_occurrence o
JOIN event e ON e.id = o.event_id
JOIN feed  f ON f.id = o.feed_id
WHERE o.starts_at < :end AND o.ends_at > :start AND f.enabled = 1
ORDER BY o.starts_at
```

An indexed range scan over pre-materialised occurrences. Because
`event_occurrence` only ever holds the rolling window, `starts_at < :end` cannot
degenerate into a scan of all history.

Results are bucketed into local day columns in JavaScript, where the display
timezone lives. A multi-day event appears under every day it covers; one ending
exactly at midnight belongs to the earlier day only.

The response carries a `revision` string that changes only when ingest actually
wrote something, so the client can skip a repaint on an unchanged poll.

## Frontend

React 18 + Bootstrap 5, built by Vite, served as static files by the backend.

`usePolling` is the whole data layer — no query library. It keeps the last good
value on screen while a refresh is in flight (a wall display must never flash a
spinner or blank on a transient network blip), pauses while the tab is hidden,
and re-fetches immediately on wake so a screen coming out of sleep is current.

The dashboard hides the navbar and puts a faint gear in the top-right corner
instead: an admin affordance that does not eat space the calendar wants.

### The day grid

Each day is a time grid, not a list: an event's vertical position and height are
its start and duration. Every column on screen shares one scale, computed in
`utils/timeline.ts` from the earliest start and the latest end across all days —
padded and snapped out to whole hours. Two consequences are deliberate:

- The grid fills the viewport exactly, so nothing is ever scrolled out of reach
  on a display with no input device.
- The same clock time sits at the same height in every column, so the week is
  read by scanning across rather than reading each column's labels.

Events that overlap are split into lanes; a cluster of overlapping events all
use the same lane count, so column edges line up instead of jittering per event.
All-day events have no place on a time axis, so they sit in a band above it that
reserves the same height in every column — otherwise one busy day would push its
neighbours' hour lines out of step. How much detail a block shows (end time,
location, feed) follows from its rendered height via CSS container queries, so a
20-minute event still reads as a title rather than a clipped paragraph.

## Presence — the camera, later

The plumbing exists; the detector does not.

- `person` / `feed_person` already model who a calendar belongs to.
- `POST /api/presence/sightings` accepts `{ personId, confidence, source }`.
- `GET /api/presence` returns whoever was seen inside `PRESENCE_WINDOW_SECONDS`.
- `GET /api/agenda` **already** narrows itself to the present set when one
  exists, and shows everything when it is empty.

So the remaining work is exactly one component: a process on the Pi that reads
the camera, recognises faces locally, and POSTs sightings. Frames never need to
leave the device, and nothing in the API or schema has to change to accommodate
it.

## Deliberate omissions

Worth stating so they read as decisions rather than oversights:

- **No write-back to calendars.** Feeds are read-only; ICS subscription URLs are
  one-way by design.
- **No user accounts.** A single shared display on a home LAN. Admin mutations
  are gated by an optional shared token; reads are open.
- **No WebSocket/SSE.** Polling once a minute is simpler, survives suspend/resume
  and Wi-Fi drops without reconnect logic, and matches how often the data can
  actually change.
- **No ORM.** All SQL is in `db/repositories/`. The schema is small and the hot
  query is hand-tuned around one index.
