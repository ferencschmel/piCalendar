# Backend and database setup

Everything needed to take piCalendar from a blank Raspberry Pi to a working
wall display, plus the reasoning behind the database choices so you can operate
it confidently.

---

## 1. Why SQLite

The backend stores everything in a single SQLite file via
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

For this workload that is not a compromise, it is the right answer:

| Consideration     | Why SQLite wins here                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory**        | A Pi Zero 2 W has 512 MB. SQLite runs inside the Node process and uses a few MB. PostgreSQL wants a background server, shared buffers and WAL writers before it stores a single event. |
| **Write volume**  | A dozen calendars refreshed every 15 minutes is a handful of writes per hour. There is no concurrency problem to solve.                                                                |
| **Read shape**    | The dashboard issues one indexed range query per poll. SQLite serves that from page cache in microseconds.                                                                             |
| **SD-card wear**  | One file, WAL mode, `synchronous=NORMAL`. A server-based engine writes far more for the same data.                                                                                     |
| **Backups**       | `cp picalendar.sqlite backup.sqlite` after a checkpoint. No dump tooling, no version-matched restore.                                                                                  |
| **Failure modes** | No daemon to fail to start, no socket permissions, no port conflicts. If the app runs, the database runs.                                                                              |

The one thing SQLite genuinely cannot do is serve multiple machines. If you ever
run several displays against one dataset, they should all talk to this Pi's HTTP
API — which is already how the frontend works — rather than sharing the file.

### The pragmas, and why

Set in `apps/backend/src/db/index.ts`:

```
journal_mode = WAL      -- dashboard reads never block on the sync worker's writes
synchronous = NORMAL    -- WAL-safe; removes an fsync per commit, the biggest SD-card win
foreign_keys = ON       -- deleting a feed must take its events with it
busy_timeout = 5000     -- wait rather than throw if a write is briefly in flight
cache_size = -8000      -- 8 MB page cache, enough to hold the hot agenda index
mmap_size = 67108864    -- 64 MB memory map; avoids read() syscalls on the hot path
temp_store = MEMORY     -- sorting spills to RAM, not to the SD card
```

`synchronous = NORMAL` under WAL can lose the last few committed transactions in
a hard power cut, but cannot corrupt the database. For a calendar cache that is
rebuilt from upstream feeds on the next sync, that is a good trade. If the Pi is
on a UPS or you would rather not, set `synchronous = FULL`.

---

## 2. Schema

Five tables carry the application, plus bookkeeping. Full DDL with comments is
in `apps/backend/src/db/migrations/001_init.sql`.

```
person ──┐
         ├── feed_person ── feed ──┬── event ── event_occurrence
         │                         └── sync_run
presence_sighting
```

**`feed`** — one configured calendar URL. Holds the refresh interval, the HTTP
cache validators (`http_etag`, `http_last_modified`) and a hash of the last body
we parsed, so an unchanged calendar costs one 304 and no work at all.

**`event`** — the event as authored upstream. For a recurring series this is the
master row and keeps the `RRULE` text so the series can be re-expanded when the
materialisation window rolls forward. Identity is
`(feed_id, uid, recurrence_id)`; `recurrence_id` is `''` for a normal event and
set for a "this occurrence only" edit.

**`event_occurrence`** — the key design decision. Recurring events are expanded
into concrete instances **at ingest time**, not at query time. The dashboard's
query is therefore a plain integer range scan and never evaluates an RRULE:

```sql
CREATE INDEX idx_occurrence_window
  ON event_occurrence (starts_at, ends_at, feed_id);
```

The cost is bounded storage — only a rolling window is materialised
(`OCCURRENCE_WINDOW_PAST_DAYS` back, `OCCURRENCE_WINDOW_FUTURE_DAYS` forward),
pruned on every sync pass.

**`person`** and **`feed_person`** — who a calendar belongs to. Many-to-many, so
a shared family calendar can map to several people. Nothing on the dashboard
requires it today; it is the join the camera will use.

**`presence_sighting`** — append-only log of "who was seen, when". Written by
the future camera detector, read by `GET /api/presence`. Pruned to seven days.

### Time storage

Every timestamp is an **INTEGER unix second in UTC**. Range queries are then raw
integer comparisons against a b-tree index — no string parsing, no timezone
maths in SQL.

All-day events are the subtle case. `DTSTART;VALUE=DATE:20260612` means "the
12th" wherever the screen is, so it is anchored to **local midnight in
`DISPLAY_TIMEZONE`** at ingest. Getting this wrong shows all-day events on the
wrong day for any screen not on UTC — `apps/backend/test/parser.test.ts` pins
the behaviour, and CI re-runs the suite under four different process timezones.

### Migrations

Forward-only numbered `.sql` files in
`apps/backend/src/db/migrations/`. Each runs inside a transaction together with
its bookkeeping row, so a failure part-way through a file leaves nothing
half-applied. Applied automatically at startup; run manually with:

```bash
npm run migrate
```

To add one, create the next numbered file (`002_add_something.sql`). Do not edit
an applied migration — it will not re-run.

---

## 3. Local development

Requires **Node.js 22 or newer** (`better-sqlite3` v13 needs it).

```bash
git clone https://github.com/your-user/piCalendar.git
cd piCalendar
npm install

cp .env.example .env      # optional; defaults work out of the box
npm run build --workspace @picalendar/shared   # both apps compile against it
npm run migrate
npm run dev
```

`npm run dev` starts the API on **http://localhost:4000** and the Vite dev
server on **http://localhost:5173**. Use the Vite URL — it proxies `/api` to the
backend, so the browser sees a single origin.

| Command                           | What it does                            |
| --------------------------------- | --------------------------------------- |
| `npm run dev`                     | Backend and frontend with hot reload    |
| `npm run build`                   | Build all three packages                |
| `npm test`                        | Backend test suite                      |
| `npm run lint` / `npm run format` | ESLint / Prettier                       |
| `npm run typecheck`               | Typecheck every package, tests included |
| `npm run migrate`                 | Apply pending migrations                |

By default the dev database is `apps/backend/data/picalendar.sqlite`.

---

## 4. Raspberry Pi installation

Tested against Raspberry Pi OS (Bookworm, 64-bit) on a Pi 3 or newer. A Pi Zero
2 W works; expect a slower first build.

### Automated

```bash
sudo REPO_URL=https://github.com/your-user/piCalendar.git \
  bash deploy/install.sh
```

The script installs Node 22 from NodeSource, creates a `picalendar` system user,
clones and builds the project into `/opt/picalendar`, writes
`/etc/picalendar/picalendar.env`, runs migrations, and installs and starts the
systemd unit. It is idempotent — re-run it to update.

### Manual

```bash
# 1. Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs build-essential python3

# 2. Service user and directories
sudo useradd --system --home-dir /opt/picalendar --shell /usr/sbin/nologin picalendar
sudo mkdir -p /opt/picalendar /var/lib/picalendar /etc/picalendar
sudo chown -R picalendar:picalendar /opt/picalendar /var/lib/picalendar

# 3. Code. Build ON THE PI: better-sqlite3 is a native module and must be
#    linked against this machine's architecture.
sudo -u picalendar git clone https://github.com/your-user/piCalendar.git /opt/picalendar
sudo -u picalendar npm --prefix /opt/picalendar ci
sudo -u picalendar npm --prefix /opt/picalendar run build

# 4. Configuration
sudo cp /opt/picalendar/.env.example /etc/picalendar/picalendar.env
sudo chown root:picalendar /etc/picalendar/picalendar.env
sudo chmod 640 /etc/picalendar/picalendar.env
sudo nano /etc/picalendar/picalendar.env      # set DISPLAY_TIMEZONE at minimum

# 5. Service
sudo cp /opt/picalendar/deploy/picalendar.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now picalendar
```

Verify:

```bash
systemctl status picalendar
journalctl -u picalendar -f
curl -s http://localhost:4000/api/health | jq
```

Then open `http://<pi-address>:4000/` for the dashboard and
`http://<pi-address>:4000/admin` to add feeds.

> **Set `DISPLAY_TIMEZONE`.** It defaults to `UTC`, and if it does not match the
> room, all-day events land on the wrong day.

### Kiosk mode

See [`deploy/kiosk-autostart.md`](../deploy/kiosk-autostart.md) for Chromium
autostart, hiding the cursor and disabling screen blanking.

---

## 5. Adding calendar feeds

Both supported providers publish standard iCalendar over HTTP, so there is one
ingestion path with small per-provider clean-ups.

**Apple iCloud (shared calendar)**

1. Calendar app → right-click the calendar → _Share Calendar…_
2. Tick **Public Calendar**
3. Copy the `webcal://p…-calendars.icloud.com/published/…` link

The calendar must be **public**. A private share is an invitation to a specific
Apple ID and cannot be read by a URL fetch.

**SportsEngine**

1. Open the team's _Schedule_ page
2. **Subscribe to calendar** / the RSS-style calendar icon
3. Copy the `webcal://` link

Paste either into _Administration → Add feed_. `webcal://` is rewritten to
`https://` automatically. Use **Test** before saving: it fetches and parses the
URL and reports how many events it found, which catches a typo or a
still-private calendar immediately.

---

## 6. Configuration reference

Full list with defaults in [`.env.example`](../.env.example). The ones that
matter most:

| Variable                        | Default                               | Notes                                                |
| ------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `DISPLAY_TIMEZONE`              | `UTC`                                 | IANA zone the display renders in. **Set this.**      |
| `DATABASE_PATH`                 | `apps/backend/data/picalendar.sqlite` | Use an absolute path in production                   |
| `PORT` / `HOST`                 | `4000` / `0.0.0.0`                    | `0.0.0.0` exposes it to the LAN                      |
| `SYNC_TICK_SECONDS`             | `60`                                  | Scheduler resolution; each feed has its own interval |
| `OCCURRENCE_WINDOW_FUTURE_DAYS` | `180`                                 | How far ahead recurring events are materialised      |
| `PRESENCE_WINDOW_SECONDS`       | `300`                                 | How long a camera sighting keeps someone "present"   |
| `HTTPS_ENABLED`                 | `false`                               | Only `true` behind real TLS — see troubleshooting    |
| `ADMIN_TOKEN`                   | unset                                 | See below                                            |

### About `ADMIN_TOKEN`

When unset, the admin endpoints are **unauthenticated**. That is deliberate: on
a trusted home LAN, a wall display nobody can configure without hunting for a
token is worse than useless.

Set it before the Pi is reachable from anywhere less trusted. The frontend has a
field for it under _Administration → Admin token_; it is stored in that
browser's local storage and sent as a bearer token. Reads (`GET /api/agenda`,
`/api/feeds`, `/api/presence`) stay open either way, so the display itself needs
no credentials.

---

## 7. Backups

```bash
# Consistent copy while the service is running.
sqlite3 /var/lib/picalendar/picalendar.sqlite ".backup '/home/pi/picalendar-$(date +%F).sqlite'"
```

Weekly via cron is plenty. Only your _configuration_ — feeds, people, colours —
is irreplaceable; events are re-fetched from upstream on the next sync.

Restore by stopping the service, replacing the file, and starting it again.

---

## 8. Troubleshooting

**The page is blank / white, but `curl` returns the HTML.** The browser fetched
`index.html` and then failed to fetch the bundle it references, so React never
mounted and `<div id="root">` stayed empty. Open the browser console: repeated
`net::ERR_SSL_PROTOCOL_ERROR` on `/assets/*.js` means something asked the
browser to upgrade those requests to https on a server that only speaks http.
Check `HTTPS_ENABLED` is `false` in `picalendar.env` (it must be, unless you
have actually put TLS in front of the app) and confirm the response has no
`upgrade-insecure-requests` and no `Strict-Transport-Security`:

```bash
curl -sI http://<pi-address>:4000/ | grep -iE 'content-security-policy|strict-transport'
```

If a browser already cached an HSTS pin for the host, clear it at
`chrome://net-internals/#hsts` — the header is gone but the pin outlives it.

**Nothing answers on port 80** (`ERR_CONNECTION_REFUSED` for
`http://<pi-address>/`). The Node process listens on `PORT`, **4000** by
default — nothing binds 80 unless you put nginx in front. Either use
`http://<pi-address>:4000/`, or install the reverse proxy:

```bash
sudo apt-get install -y nginx
sudo cp /opt/picalendar/deploy/nginx-picalendar.conf /etc/nginx/sites-available/picalendar
sudo ln -sf /etc/nginx/sites-available/picalendar /etc/nginx/sites-enabled/picalendar
sudo rm -f /etc/nginx/sites-enabled/default   # it also claims default_server
sudo nginx -t && sudo systemctl reload nginx
```

Binding the app to 80 directly is the other option, but a port below 1024 needs
root or `CAP_NET_BIND_SERVICE`, which is exactly what the hardened unit avoids.

**A feed shows "Failed" in the admin table.** Hover the status for the message;
it is also in `lastError` from `GET /api/feeds`. Common causes: the iCloud
calendar was never made public (`403`/`404`), or a typo in the URL
(`getaddrinfo ENOTFOUND`).

**Events appear one day off.** `DISPLAY_TIMEZONE` does not match the room.
Fix it and restart — all-day events are re-anchored on the next sync.

**Recurring events are missing beyond a few months.** They are only materialised
`OCCURRENCE_WINDOW_FUTURE_DAYS` ahead. Raise it and restart; the window also
advances by itself on every sync.

**`better-sqlite3` fails to install.** No prebuilt binary for your Node version,
so it fell back to compiling. Install the toolchain
(`sudo apt-get install -y build-essential python3`) and retry. Check you are on
Node 22 or newer.

**Service will not start.** `journalctl -u picalendar -n 50`. An invalid value in
`picalendar.env` fails fast at startup with the offending variable named.

**Dashboard shows a stale-data warning.** The browser has not had a successful
poll in over two minutes. Check the service is up and the Pi is on the network;
the last-known agenda stays on screen deliberately rather than blanking.
