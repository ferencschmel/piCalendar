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

## Frontend

`usePolling` is the entire data layer — no query library. It keeps the last good
value on screen while a refresh is in flight, pauses while the tab is hidden,
re-fetches on wake, and takes an `enabled` flag so parked views stop fetching
without unmounting.

The dashboard has three views (week / month / year) sharing one header. Week and
month share a poll and differ only in the range requested; the year uses the
compact density endpoint. Period anchors are stored as _overrides_ where `null`
means "whatever period today falls in", so an unattended display rolls into the
new month by itself.

`AgendaResponse.revision` changes only when ingest actually wrote something, so a
client can skip a repaint on an unchanged poll.

The admin page is reached by a deliberately faint gear in the corner — an
affordance that does not eat space the calendar wants.

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
