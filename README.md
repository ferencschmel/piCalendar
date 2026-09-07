# piCalendar

A wall-mounted household calendar for the Raspberry Pi. It aggregates
**SportsEngine** team schedules and **Apple iCloud shared calendars** into one
always-on display showing today and the week ahead — or the whole month or year
at a glance — and refreshes itself so the wall is never out of date.

```
┌──────────────────────────────────────────────────────────────────┐
│  16:48                                          Alice   Ben   ⚙  │
│  Sunday, 6 September                        Updated 16:48        │
├──────────┬──────────┬──────────┬──────────┬──────────┬───────────┤
│  Today   │ Monday   │ Tuesday  │ Wednesday│ Thursday │  Friday   │
│  6 Sep   │  7 Sep   │  8 Sep   │  9 Sep   │  10 Sep  │  11 Sep   │
├──────────┼──────────┼──────────┼──────────┼──────────┼───────────┤
│ 16:00    │ All day  │          │ 17:30    │          │ 09:00     │
│ Tigers   │ School   │ Nothing  │ Piano    │ Nothing  │ Dentist   │
│ vs Lions │ sports   │ scheduled│ lesson ⟳ │ scheduled│           │
│ ● Swim   │ day      │          │ ● Family │          │ ● Family  │
│          │ ● School │          │          │          │           │
│ 19:00    │          │          │          │          │           │
│ Swim     │ 19:00    │          │          │          │           │
│ practice⟳│ Swim ⟳   │          │          │          │           │
└──────────┴──────────┴──────────┴──────────┴──────────┴───────────┘
```

## What it does

- **One display, many calendars.** SportsEngine and iCloud both publish
  iCalendar over HTTP, so there is a single ingestion pipeline with small
  per-provider clean-ups rather than two integrations.
- **Stays current on its own.** Each feed has its own refresh interval; the
  browser re-polls every minute and shows a warning if it falls behind.
- **Week, month and year.** The week is a time grid; the month is six rows of
  seven with a coloured dot per entry; the year is twelve mini-months marked by
  which calendars are busy. Step through months and years, or tap a day to
  drill in.
- **Admin page for feeds.** Add, test, colour-code, enable/disable, sync now.
  The **Test** button fetches and parses a URL before you commit to it.
- **Correct across timezones and DST.** All-day events land on the right day and
  a 19:00 practice stays at 19:00 through a clock change. CI runs the suite under
  four process timezones to keep it that way.
- **Built for the hardware.** SQLite in WAL mode, conditional HTTP requests and
  content hashing mean a steady-state sync writes nothing at all.
- **Ready for the camera.** People, feed ownership and a presence API already
  exist; the agenda narrows to whoever is detected in the room. Only the
  detector itself is missing.

## Stack

TypeScript throughout. **Backend:** Node.js 22+, Express 5, SQLite via
better-sqlite3, node-ical, zod, pino. **Frontend:** React 18, Bootstrap 5, Vite.
npm workspaces monorepo.

## Quick start

Requires Node.js **22 or newer**.

```bash
npm install
npm run build --workspace @picalendar/shared
npm run migrate
npm run dev
```

Open **http://localhost:5173** — the dashboard. Feeds are configured at
**/admin**.

## On a Raspberry Pi

```bash
sudo REPO_URL=https://github.com/your-user/piCalendar.git bash deploy/install.sh
```

Installs Node, creates a service user, builds into `/opt/picalendar`, runs
migrations and starts a hardened systemd unit. Then open
`http://<pi-address>:4000/`.

**Set `DISPLAY_TIMEZONE`** in `/etc/picalendar/picalendar.env` — it defaults to
UTC, and if it does not match the room, all-day events land on the wrong day.

Full instructions, including manual setup and kiosk mode:
[`docs/SETUP.md`](docs/SETUP.md).

## Adding calendars

**iCloud** — Calendar app → right-click the calendar → _Share Calendar…_ → tick
**Public Calendar** → copy the `webcal://` link. It must be public; a private
share is tied to an Apple ID and cannot be fetched by URL.

**SportsEngine** — team _Schedule_ page → _Subscribe to calendar_ → copy the
`webcal://` link.

Paste either into _Administration → Add feed_ and press **Test** before saving.

## Documentation

| Document                                                 | Contents                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`docs/SETUP.md`](docs/SETUP.md)                         | Backend and database setup, schema, Pi installation, configuration, backups, troubleshooting  |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)           | How it fits together and why; the recurrence/timezone handling; what is deliberately left out |
| [`docs/API.md`](docs/API.md)                             | HTTP endpoints and payloads                                                                   |
| [`deploy/kiosk-autostart.md`](deploy/kiosk-autostart.md) | Chromium kiosk mode on the Pi                                                                 |

## Layout

```
packages/shared/    zod schemas + types shared across the wire
apps/backend/       Express API, SQLite, feed ingestion, scheduler
apps/frontend/      React SPA (dashboard + admin)
deploy/             systemd unit, install script, nginx, kiosk notes
docs/               setup, architecture, API
```

## Commands

| Command                           | Description                          |
| --------------------------------- | ------------------------------------ |
| `npm run dev`                     | Backend + frontend with hot reload   |
| `npm run build`                   | Build all packages                   |
| `npm test`                        | Backend test suite                   |
| `npm run lint` / `npm run format` | ESLint / Prettier                    |
| `npm run typecheck`               | Typecheck everything, tests included |
| `npm run migrate`                 | Apply pending migrations             |

## CI/CD

- **`.github/workflows/ci.yml`** — format, lint, typecheck, test and build on
  Node 22 and 24, plus a job that re-runs the suite under four process
  timezones.
- **`.github/workflows/deploy.yml`** — on push to `main`, reuses the CI pipeline
  as its gate, then rsyncs to the Pi over SSH, builds _on the device_ (
  better-sqlite3 is native and must match the Pi's architecture), migrates,
  restarts the service and polls `/api/health` until it comes back.

Deployment is skipped unless `PI_HOST` is configured, so a fork does not fail.

| Secret                          | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `PI_HOST`, `PI_USER`, `PI_PORT` | SSH target (`PI_PORT` defaults to 22)            |
| `PI_SSH_KEY`                    | Private deploy key                               |
| `PI_KNOWN_HOSTS`                | Pinned host key — output of `ssh-keyscan <host>` |

| Variable      | Default           |
| ------------- | ----------------- |
| `DEPLOY_PATH` | `/opt/picalendar` |
| `APP_PORT`    | `4000`            |

The deploy user needs passwordless `sudo systemctl restart picalendar`. If the
Pi is not reachable from the internet, put it on a Tailscale network or register
it as a self-hosted runner and drop the SSH steps.

## Roadmap

- **Camera presence.** An on-device detector that recognises faces locally and
  POSTs to `/api/presence/sightings`. The schema, API and agenda filtering are
  already in place — see [`docs/API.md`](docs/API.md#presence-camera-future).
- Per-person dashboard themes and a "next up" hero panel.
- Weather alongside the agenda.

## License

MIT — see [LICENSE](LICENSE).
