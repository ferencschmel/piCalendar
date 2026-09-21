# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A wall-mounted household calendar for a Raspberry Pi. It ingests SportsEngine
team schedules and Apple iCloud shared calendars (both plain iCalendar over
HTTP) into SQLite and renders them on an always-on kiosk display.

Two constraints drive most design decisions, and are worth holding in mind
before changing anything:

- **The display has no input device and nobody is looking after it.** Nothing
  scrolls out of reach, the dashboard never blanks on a network blip, and stale
  data announces itself rather than being silently shown.
- **It runs on an SD card.** A steady-state sync is expected to write nothing at
  all; queries are indexed range scans over a bounded table.

## Commands

```bash
npm run dev            # backend :4000 + frontend :5173 (Vite proxies /api)
npm run build          # shared → backend → frontend, in that order
npm test               # backend vitest suite
npm run lint           # eslint (--fix available as lint:fix)
npm run typecheck      # every workspace, tests included
npm run format         # prettier (format:check in CI)
npm run migrate        # apply pending migrations
```

Single test file, or by name:

```bash
npm run test --workspace @picalendar/backend -- test/parser.test.ts
npm run test --workspace @picalendar/backend -- -t "multi-day"
```

Date handling is timezone-sensitive and CI runs the suite under `UTC`,
`Pacific/Auckland`, `America/Los_Angeles` and `Asia/Kolkata`. Reproduce a
timezone failure with `TZ=Pacific/Auckland npm test`.

**`@picalendar/shared` must be built before anything typechecks.** Both apps
compile against its _emitted_ declarations, not its source. After changing it:

```bash
npm run build --workspace @picalendar/shared
```

CI does this before every other step; a mystifying "cannot find module
@picalendar/shared" almost always means the build is stale.

## Layout

npm workspaces monorepo:

- `packages/shared` — zod schemas and types that cross the wire. The contract
  between the two apps; both import it, neither duplicates it.
- `apps/backend` — Express 5, better-sqlite3, feed ingestion, scheduler. Also
  serves the built frontend in production.
- `apps/frontend` — React 18 + Bootstrap 5 SPA, built by Vite.

`docs/ARCHITECTURE.md` carries the long-form reasoning and is kept current;
`docs/API.md` is the endpoint reference. Prefer updating those over duplicating
their content elsewhere.

## Ingestion pipeline

`icsClient` → `parser` → `adapters` → `replaceFeedEvents`

- **Conditional fetch.** ETag / `Last-Modified` first, then a body hash. A 304
  or an unchanged hash short-circuits before parsing.
- **Adapters are presentation-only** (`ingest/adapters.ts`). Parsing is identical
  for every provider; adapters strip SportsEngine's boilerplate footer and drop
  iCloud's CANCELLED-but-still-published declines. An adapter returning `null`
  drops the event. New providers go here, not in the parser.
- **Content hashing on write.** Unchanged rows only get their sync token
  stamped; rows the source stopped publishing are deleted by token mismatch.
  This is why a steady-state sync writes nothing.

### The two-table model

`event` holds the source record. `event_occurrence` holds concrete materialised
instances — recurring series are expanded into rows, but **only inside a rolling
window** (`OCCURRENCE_WINDOW_PAST_DAYS` / `OCCURRENCE_WINDOW_FUTURE_DAYS`,
default 14 back / 180 forward), recomputed and pruned on every sync.

This is load-bearing in both directions:

- Agenda reads are one indexed range scan that cannot degenerate into a scan of
  all history.
- Anything asking beyond the window sees genuinely absent data, not an empty
  calendar. `GET /api/agenda/density` reports the window as
  `coverageStart`/`coverageEnd` so the year view can draw those days as unknown
  rather than free. Preserve that distinction in any new long-range view.

## Time handling

The single most bug-prone area; treat changes here with suspicion.

- **Storage is unix seconds, UTC, everywhere.** No local times in the database.
- **`DISPLAY_TIMEZONE` is applied at the boundary**, never assumed from the
  host clock — a Pi set to UTC must still show a 19:00 practice at 19:00.
- **Timed and all-day events need opposite treatment at ingest.** `node-ical`
  builds all-day values at _local_ midnight, so their calendar date is read with
  local getters and re-anchored to midnight in the display zone. Timed values
  are absolute already.
- **`YYYY-MM-DD` day keys are timezone-free by construction** — the zone has
  already been applied by the time a date has a key. Never push a key back
  through a timezone conversion (a noon-UTC anchor breaks past UTC+12);
  `dayKeyLabel` formats them in UTC deliberately.
- Backend zone maths lives in `util/time.ts` (two-pass DST-correct wall-clock
  resolution). Frontend splits three ways: `utils/datetime.ts` owns words,
  `utils/timeline.ts` owns the week grid's geometry, `utils/calendarGrid.ts`
  owns civil-calendar arithmetic for the month and year grids.

A multi-day event appears under **every** day it covers; one ending exactly at
midnight belongs to the earlier day only. One shared bucketing function enforces
this for both the agenda and the density endpoints — keep it that way, or a dot
will appear on a day the agenda shows as empty.

**Birthdays and menus are the exceptions to all of the above.** Both store a
_civil_ date rather than unix seconds, because both name a day rather than an
instant — there is no timezone at which someone stops having been born on the
3rd of March, or at which Wednesday's dinner becomes Tuesday's.

Birthdays live on `birthday` (`birth_month` / `birth_day` / `birth_year`, the
year separately nullable); `menu_entry.day_key` is a `YYYY-MM-DD` string.
Neither is materialised: `util/birthdays.ts` and `util/menu.ts` derive the days
per request, so a steady-state sync still writes nothing and both are known
outside the occurrence window where feed marks are not. Both agenda endpoints
call those functions, for the same reason the two queries share a `WHERE`
builder. Neither is narrowed by presence — a birthday belongs to no calendar,
and dinner is cooked for whoever walks in.

The menu path performs **no timezone conversion at all**: both sides of every
comparison are already day keys. `test/menu.test.ts` pins that under all four
CI zones, and a change that makes the assertion non-trivial is a bug.

The **grocery list inherits all of this**. It is derived from `menu_entry` on
every request — every planned dish's ingredients, summed — so it is not stored,
not editable, and has no id but the literal string `grocery`; the mutating list
routes answer 404 for it without a check, because there is no row. Its dates are
day keys end to end and `test/lists.test.ts` pins that under the same four
zones. Summing (`packages/shared/src/lists.ts`) converts within a unit scale and
never across systems — `500 g` + `1 kg` is `1.5 kg`, grams and ounces stay two
parts — and unknown units group under their own spelling rather than erroring.

Ticking a derived line is the one write, and `grocery_check` stores a
**signature** with it: the amount, and the last day it is needed. Change what is
needed and the tick falls away, because a tick against an amount nobody bought
is worse than an extra tick. The signature is always derived server-side, never
taken from the request. On the client, `usePendingTicks` holds an unconfirmed
tick unconditionally while the request is in flight and only until the next poll
afterwards — an overlay that waited for the server to _agree_ would wait forever,
since the server is entitled to disagree with a tick it accepted.

## Frontend

`usePolling` is the entire data layer — no query library. It keeps the last good
value on screen while a refresh is in flight, pauses while the tab is hidden,
re-fetches on wake, and takes an `enabled` flag so parked views stop fetching
without unmounting.

`/menu` is the planning week: meals down (breakfast / lunch / dinner), days
across, with a rail holding the wishlist above the dish library. Rows rather
than meals stacked inside a day column, because that makes every drop target a
third of a seventh of the screen. `usePlacement` is the one new primitive — a
Pointer Events state machine where **tap-to-lift-then-tap-to-place is the
interaction and drag is the shortcut**, not the other way round: a drag across
a wall-mounted screen is not something everyone in a household can do. Dishes
are written up on their own route (`/menu/dishes/:id`), remounted per id so a
half-typed recipe cannot follow you onto the next dish.

A day column carries a `MenuStrip` along its bottom — below the hour grid, not
in the all-day band, because a meal has no start or end time. It is a fixed
height reserved across every column at once (`--pical-menu-rows`), exactly like
the all-day band and for the same reason: a row only some days carried would
give those days a shorter hour grid than their neighbours.

The dashboard has four views (3 days / week / month / year) sharing one header.
The first three share a poll and differ only in the range requested — three days
and a week are the same `WeekView` grid, at three columns and eight — while the
year uses the compact density endpoint. Period anchors are stored as _overrides_
where `null` means "whatever period today falls in", so an unattended display
rolls into the new month by itself.

The day grid shows a fixed twelve hours, 08:00–20:00 by default, rather than a
scale fitted to the events on screen: the hour rows are then the same height
every day. Anything outside that band is reached by dragging the grid (or the
arrows at the ends of the hour axis), and `offscreenCounts` puts a count beside
those arrows — a band narrower than the day must never let the wall imply an
empty evening. The pan is an override like the period anchors and expires the
same way, returning to 08:00–20:00 two minutes after the last touch.

`AgendaResponse.revision` changes only when ingest actually wrote something, so a
client can skip a repaint on an unchanged poll.

`Layout` wraps every page in the same frame: the page, and `AppNav` along the
bottom — calendar, tasks, menu, custom lists, settings. It is sticky and takes
real height, and the dashboard sizes itself to the viewport _minus_
`--pical-nav-height`; keep those two in step or the day grid runs under the bar.
The admin page is the "Settings" entry, still routed at `/admin`. Tasks is the
last `ComingSoon` placeholder. `Layout`'s `FULL_BLEED` set decides which routes
skip the padded container — the dashboard and the menu planner.

`/lists` is the one part of the app **not** read from across a room: it is held
in a hand, in a shop, by somebody who is not carrying the wall display with
them. Hence a 40rem column, the whole row as the tick target rather than the
checkbox inside it, fixed day options instead of a number field, and a sticky
header so the window and the add form are never scrolled away from. Keep new
work on these pages sized for a thumb, not for viewing distance.

## Conventions

- **ESM with NodeNext resolution: relative imports carry a `.js` extension**,
  including in `.tsx` files importing `.tsx`. This trips people up constantly.
- `strict` plus `noUncheckedIndexedAccess` — indexed reads are `T | undefined`.
- Type-only imports must be inline (`import { type Foo }`), enforced by lint.
- `no-console` warns outside tests and scripts; use the pino `logger`.
- Components annotate their return type as `JSX.Element`.
- **Comments explain _why_, not _what_.** The codebase leans heavily on this and
  reads as prose — new code should match that density and tone rather than
  adding bare restatements of the line below.

## Gotchas

- `better-sqlite3` is a native module, so deployment builds **on the Pi** rather
  than shipping a compiled artifact.
- Migrations are `.sql` files applied in lexical filename order
  (`001_init.sql`). `tsc` does not emit them — `scripts/copy-assets.mjs` copies
  them into `dist/` at build time.
- `test/setup.ts` sets env vars before the config singleton is imported, giving
  each run a throwaway database with the scheduler disabled. Config is read once
  at module load, so tests cannot change it afterwards.
- Vitest runs single-threaded on purpose, keeping SQLite file locking out of the
  picture.
- `ADMIN_TOKEN` is optional: when unset, admin routes are open. That is
  intentional for a LAN install, so do not "fix" it into a hard requirement.
- Presence is plumbed but has no detector. `person`, `feed_person` and the
  presence API all exist, and `/api/agenda` already narrows to whoever is
  detected; with nobody detected it shows every calendar. Keep that fallback.
- Birthdays are deliberately **not** narrowed by presence or `personId`. They
  are a separate table from `person` for the same reason: the two are different
  sets of people, and a birthday belongs to no calendar.
