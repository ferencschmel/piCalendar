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
│   ├── src/pages/            # DashboardPage, MenuPage, DishEditorPage, AdminPage
│   ├── src/components/       # DayColumn, EventCard, FeedForm, MenuWeek
│   └── src/hooks/            # usePolling, useClock, usePlacement
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

The response carries a `revision` string that changes only when something the
dashboard renders actually changed — ingest writing, or a person record being
edited — so the client can skip a repaint on an unchanged poll.

`GET /api/agenda/density` runs the same scan with five columns instead of
seventeen and no people join, collapsing each day to one mark per feed. The year
overview asks for 366 days at once, and answering that with full occurrences
would serialise megabytes of descriptions nothing on screen renders. Both go
through one shared `WHERE` builder, so a dot can never appear on a day the
agenda would show as empty.

### Birthdays are computed, not stored

Both endpoints also return a `birthdays` array per day, and it is the one thing
on the calendar that no feed provides. Birthdays live in their own `birthday`
table, and the days they fall on are derived per request in `util/birthdays.ts`.

The table is separate from `person` on purpose. A `person` is a household member
that feeds are attributed to and that the camera will one day recognise; the
grandparents, cousins and school friends whose birthdays a family calendar
carries are none of those things, and `person` rows for them would put them in
the presence set and the feed-attribution picker for no reason. Splitting them
also lets `birth_month` / `birth_day` be `NOT NULL`, since a birthday row
without a date is nothing at all.

Three more properties fall out of computing rather than storing, all wanted:

- **A steady-state sync still writes nothing.** Materialising a yearly recurrence
  into `event_occurrence` would mean rewriting those rows on every window roll,
  for three integers per person.
- **Birthdays are known outside the occurrence window.** The year view draws days
  past `coverageEnd` as unknown because no feed has been expanded there — but a
  birthday in December is computable in January, and is drawn at full strength
  while the feed marks around it stay faint.
- **A birthday is a civil date, not an instant.** Storing it as unix seconds
  would be the one place in the schema where that is wrong: there is no timezone
  at which someone stops having been born on the 3rd of March. Matching a birth
  month and day against a `YYYY-MM-DD` day key needs no zone conversion at all.

Both endpoints call the same bucketing function, for the same reason the two
queries share a `WHERE` builder. A 29 February birthday is observed on the 28th
in a common year and says so, and birthdays are deliberately **not** narrowed by
presence: whose day it is does not depend on who is in the room.

### Menus are the second civil date

`GET /api/agenda` also returns a `menu` array per day: what the household has
planned to eat. Four tables carry it — `dish` and its `dish_ingredient` rows are
the library, `menu_wish` is the wishlist, and `menu_entry` is a dish planned for
a meal on a day.

`menu_entry.day_key` is a `YYYY-MM-DD` string, not unix seconds, and it is the
only other place in the schema that departs from the storage rule. The reasoning
is the birthdays' exactly: Wednesday's dinner is Wednesday's dinner, and
anchoring it to an instant would have a display east of UTC serving it on
Tuesday. Because both sides of the comparison are day keys, **no timezone
conversion happens in the menu path at all** — `util/menu.ts` compares strings,
and `test/menu.test.ts` pins that under all four CI zones.

The same three properties follow as for birthdays: a steady-state sync writes
nothing (ingest never touches these tables — only a person planning a meal
does), a menu is known outside the occurrence window, and there is no zone
maths to get wrong. Menus are **not** narrowed by presence either: dinner is
cooked for whoever walks in.

A day is two axes, not a flat list. `meal` says when it is eaten
(breakfast / lunch / dinner) and `course` says what it is within that meal
(starter / soup / main / side / dessert / drink). Both vocabularies live in
`packages/shared/src/menu.ts`, and the array order there _is_ the serving order
the dashboard sorts by — so the SQL `CHECK` constraints, the course picker and
the comparator cannot drift apart. Uniqueness is scoped `(day_key, meal,
dish_id)` rather than to the day, because yesterday's stew reheated for lunch
and served again at dinner is a real plan; a repeat within one sitting is a
double-tap and answers 409.

Ingredients carry a nullable `quantity` and a free-text `unit`. Structured
enough that the editor can suggest the unit an ingredient is usually measured
in — `GET /api/dishes/ingredients` folds the library's distinct names
case-insensitively and reports each one's most-used non-empty unit, which is
what stops "Onion", "onion" and "Brown onion" becoming three unrelated things.
Not an enum, because a household measures in cloves, tins and bunches and a
`CHECK` constraint would reject the ingredient rather than the typo.

`AgendaDensityDay` deliberately gains nothing. Density feeds the year grid only,
where a day is the area of a fingernail and already carries feed marks and a
birthday — a fork glyph at that scale is noise. The density `revision` still
includes the menu token, so a client sharing it across views cannot skip a
repaint it needed.

## Frontend

React 18 + Bootstrap 5, built by Vite, served as static files by the backend.

`usePolling` is the whole data layer — no query library. It keeps the last good
value on screen while a refresh is in flight (a wall display must never flash a
spinner or blank on a transient network blip), pauses while the tab is hidden,
and re-fetches immediately on wake so a screen coming out of sleep is current.

Every page sits in one frame: the page itself, and a navigation bar along the
bottom edge — calendar, tasks, menu, custom lists, settings, each an icon and a
word. Bottom rather than top because a wall-mounted screen is reached by hand
and the bottom edge is the part of it a person can touch without stretching;
icon _and_ word because the icons alone are a guessing game for someone who
uses this twice a week. The bar is sticky and occupies real height rather than
floating over the page, and the dashboard subtracts that height from the
viewport (`--pical-nav-height`) — nothing on an unattended display may end up
underneath chrome nobody can scroll out from behind.

Tasks, menu and custom lists are placeholders for now, and say so on the page
rather than showing an empty shell: a blank page is indistinguishable from one
that failed to load. Settings is the admin page, still routed at `/admin`.

Inside the dashboard's own header, the view switcher and — off the week view —
a period stepper sit between the clock and the sync status, the one part of the
header meant to be touched; everything either side of them is information.

### Four views

The calendar takes one of four shapes, each answering a different question.

| View   | Question                            | Source                |
| ------ | ----------------------------------- | --------------------- |
| 3 days | What is happening today, in detail? | `/api/agenda?days=3`  |
| Week   | What is happening this week?        | `/api/agenda?days=8`  |
| Month  | How busy is the rest of the month?  | `/api/agenda?days=42` |
| Year   | Which weeks are busy? Which month?  | `/api/agenda/density` |

Three days and a week are the same component and the same grid; a third of a
wall is simply wide enough for a block to carry its location and feed, which an
eighth is not. Neither takes a period stepper — both are anchored on today, the
way a wall display that nobody resets has to be.

Only the view on screen polls: `usePolling` takes an `enabled` flag, so the two
hooks park rather than unmount and switching back paints from the last snapshot
instead of a spinner. The three agenda views share a hook because they differ
only in the range they request — the requested day count identifies which
response belongs to which, so a month's 42 days is never rendered through the
week's layout while a switch is in flight.

The month and year anchors are stored as _overrides_: `null` means "whatever
period today falls in", so an unattended display rolls into the new month by
itself rather than sticking wherever it was last left. Stepping pins a period;
"Today" hands it back and the button hides itself again.

`utils/calendarGrid.ts` does the civil-calendar arithmetic on `YYYY-MM-DD`
keys, which are timezone-free by construction — the display zone has already
been applied by the time a date has a key. Month grids are always six rows of
seven, Monday first: a wall display that resized its cells as you stepped
through the year would be far more distracting than two greyed-out trailing
days.

A month cell draws one dot per entry in its feed's colour, and each dot is a
button that opens the same `EventDetail` popup a week-view block does. A year
cell has roughly the area of a fingernail, so it draws at most three dots — one
per feed, not per event — and tapping anywhere in a mini-month steps into it.

### The day grid

Each day is a time grid, not a list: an event's vertical position and height are
its start and duration. Every column on screen shares one scale, defined in
`utils/timeline.ts`: a fixed twelve-hour band, 08:00–20:00 unless someone moves
it. Two consequences are deliberate:

- The grid fills the viewport exactly, so nothing is ever scrolled out of reach
  on a display with no input device.
- The same clock time sits at the same height in every column — and at the same
  height it was yesterday, which a scale fitted to each day's events could not
  promise. A wall read from across the room should not need its axis checked
  first.

Twelve hours of a twenty-four hour day means the 06:30 swim and the 21:00 pickup
can fall outside it, so the band moves. `useTimeWindow` owns where it is:
dragging any column pans it — measured against that column's own height, so the
hour lines travel exactly as far as the finger — and the arrows at the ends of
the hour axis step it two hours at a time. Three details earn their keep:

- **The band is an override.** It slides back to 08:00–20:00 two minutes after
  the last touch, for the same reason the month anchor does: whoever dragged it
  has walked away, and the display has to be right again by morning.
- **Nothing is hidden quietly.** `offscreenCounts` counts the blocks above and
  below the band and the axis prints that beside each arrow. A display with no
  scrollbar has no other way to admit that the evening is not actually empty.
- **A drag that starts on an event still pans.** The handlers sit on the
  timeline, not the blocks; six pixels of movement turns the press into a pan
  and swallows the click that would otherwise open a popup on the way out.

On a screen too narrow for side-by-side columns the days stack and the page
scrolls, so a vertical drag has to mean "scroll" — there the hour axis flattens
into a sticky strip of just those two arrows, which keeps the early and late
edges of the day reachable.

Events that overlap are split into lanes; a cluster of overlapping events all
use the same lane count, so column edges line up instead of jittering per event.
All-day events have no place on a time axis, so they sit in a band above it that
reserves the same height in every column — otherwise one busy day would push its
neighbours' hour lines out of step. How much detail a block shows (end time,
location, feed) follows from its rendered height via CSS container queries, so a
20-minute event still reads as a title rather than a clipped paragraph.

The rest of what the feed said — description, organiser, link, status — is one
tap away: every block is a button that opens `EventDetail` beside it, over the
neighbouring day rather than over the event being read. The popup is positioned
in viewport coordinates (the columns clip their overflow, so it cannot live
inside one) and mirrors to the other side when it would run off the edge. It
closes on the ×, on Escape, on a tap outside, and on its own after twenty
seconds — a wall display nobody touches again has to return to showing the week.

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
