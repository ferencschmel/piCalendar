# HTTP API

Base path `/api`. All bodies are JSON. Errors use one envelope:

```json
{ "error": { "code": "validation_failed", "message": "…", "details": { "url": ["…"] } } }
```

| Status | `code`              | Meaning                                                       |
| ------ | ------------------- | ------------------------------------------------------------- |
| 400    | `bad_request`       | Malformed request                                             |
| 401    | `unauthorized`      | `ADMIN_TOKEN` is set and the bearer token is missing or wrong |
| 404    | `not_found`         | No such record or route                                       |
| 409    | `conflict`          | Unique constraint, e.g. a feed URL already configured         |
| 422    | `validation_failed` | Schema validation; `details` is keyed by field                |
| 500    | `internal_error`    | Unexpected failure                                            |

Routes marked **admin** require `Authorization: Bearer <ADMIN_TOKEN>` when that
variable is set, and are open when it is not. Everything else is always
readable, so the display itself needs no credentials.

---

## `GET /api/health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 3812,
  "database": { "ok": true, "path": "/var/lib/picalendar/picalendar.sqlite" },
  "feeds": { "total": 3, "enabled": 3, "failing": 0 },
  "time": "2026-09-06T16:48:22.001Z"
}
```

`status` is `degraded` when the database is unreadable or any feed is failing.
The code stays **200** either way — a broken calendar feed should not make a
supervisor restart a healthy process.

---

## `GET /api/agenda`

The dashboard's only continuous query.

| Query param | Default | Notes                                              |
| ----------- | ------- | -------------------------------------------------- |
| `start`     | today   | `YYYY-MM-DD` in `DISPLAY_TIMEZONE`                 |
| `days`      | `8`     | 1–42, including the start day (a month grid is 42) |
| `personId`  | —       | Repeatable. Restricts to those people's feeds      |
| `feedId`    | —       | Repeatable                                         |

With no `personId`, the server falls back to whoever the camera currently
reports as present. When nobody is detected — which is always, until the camera
exists — every enabled calendar is shown.

```json
{
  "generatedAt": "2026-09-06T16:48:22.001Z",
  "rangeStart": "2026-09-05T22:00:00.000Z",
  "rangeEnd": "2026-09-13T22:00:00.000Z",
  "timezone": "Europe/Budapest",
  "revision": "17:2026-09-06:8:all",
  "days": [
    {
      "date": "2026-09-06",
      "isToday": true,
      "occurrences": [
        {
          "id": "9f1c…",
          "eventId": "3a…",
          "feedId": "f9…",
          "feedName": "Swim Club",
          "feedColor": "#20c997",
          "sourceType": "sportsengine",
          "uid": "today-match@x",
          "summary": "Tigers vs Lions",
          "description": null,
          "location": "Home pitch",
          "url": null,
          "organizer": null,
          "status": null,
          "allDay": false,
          "startsAt": "2026-09-06T14:00:00.000Z",
          "endsAt": "2026-09-06T15:30:00.000Z",
          "isRecurring": false,
          "people": []
        }
      ],
      "birthdays": []
    }
  ]
}
```

`revision` changes when ingest wrote something, and when a person record was
added, edited or removed — birthdays are not ingested, so a client that skips
repaints on an unchanged revision would otherwise miss them. Compare it across
polls to decide whether a re-render is warranted.

A multi-day event appears under **every** day it covers. One ending exactly at
midnight belongs to the earlier day only.

### `birthdays`

Whose birthday falls on the day. These come from the `birthday` table rather
than from any feed, and are never filtered by `personId` or presence — a
birthday belongs to no calendar, and the people it names are usually not
household members at all.

```json
{
  "birthdayId": "b2…",
  "displayName": "Ada",
  "color": "#d63384",
  "icon": "bi-balloon",
  "date": "2026-09-09",
  "age": 9,
  "observed": false
}
```

`age` is `null` when no birth year is on file, and on the birth day itself.
`observed` is `true` when a 29 February birthday has been moved to the 28th
because the year has no 29th.

---

## `GET /api/agenda/density`

The same days as `/api/agenda`, reduced to one coloured mark per feed per day.
This is what the dashboard's month and year overviews poll: they draw dots
rather than text, and the year asks for 366 days at a time — enough that full
occurrences would be megabytes of descriptions per poll.

Takes the same query parameters, except `days`, which accepts **1–366**
(default `42`).

```json
{
  "generatedAt": "2026-09-07T16:48:22.001Z",
  "timezone": "Europe/Budapest",
  "coverageStart": "2026-08-24T16:48:22.000Z",
  "coverageEnd": "2027-03-06T16:48:22.000Z",
  "days": [
    {
      "date": "2026-09-07",
      "isToday": true,
      "marks": [
        { "feedId": "f9…", "feedName": "Swim Club", "color": "#20c997", "count": 2 },
        { "feedId": "3a…", "feedName": "U12 Football", "color": "#e8590c", "count": 1 }
      ],
      "total": 3,
      "birthdays": []
    }
  ]
}
```

`marks` is ordered by each feed's first event of the day, and `count` is how
many events that feed has — so one busy calendar stays one dot. `total` counts
every occurrence on the day across all feeds.

`coverageStart` / `coverageEnd` report the rolling window ingest has actually
materialised occurrences into (`OCCURRENCE_WINDOW_PAST_DAYS` /
`OCCURRENCE_WINDOW_FUTURE_DAYS`). A day outside it has no marks because nothing
has been expanded there yet, **not** because the calendar is empty; the year
view draws those days faint rather than claiming they are free.

Days are bucketed exactly as `/api/agenda` buckets them, multi-day events
included. `birthdays` carries the same objects the agenda does, and unlike
`marks` it is populated **outside** the coverage window too: a birthday is
computed from the person record, so it is known for any date the grid can ask
about.

---

## Feeds

### `GET /api/feeds`

`{ "feeds": [Feed, …] }`

### `GET /api/feeds/:id`

`{ "feed": Feed, "recentRuns": [SyncRun, …] }` — the last 10 sync attempts.

### `POST /api/feeds` — **admin**

```json
{
  "name": "U12 Football",
  "sourceType": "sportsengine",
  "url": "webcal://…",
  "color": "#0d6efd",
  "enabled": true,
  "refreshIntervalSeconds": 900,
  "personIds": []
}
```

`name`, `sourceType` and `url` are required; the rest default as shown.
`sourceType` is one of `sportsengine` | `icloud` | `ics`. A `webcal://` URL is
rewritten to `https://` before it is stored. → **201** `{ "feed": Feed }`

### `PATCH /api/feeds/:id` — **admin**

Any subset of the create body. Changing `url` clears the cached HTTP validators
and forces a full re-read on the next sync.

### `DELETE /api/feeds/:id` — **admin**

→ **204**. Cascades to the feed's events and occurrences.

### `POST /api/feeds/:id/sync` — **admin**

Refresh now, ignoring the feed's interval.

```json
{ "outcome": { "status": "ok" | "skipped" | "error",
               "upserted": 5, "deleted": 0, "message": null },
  "feed": Feed }
```

`skipped` means the source reported no change — a success, not a failure.

### `POST /api/feeds/test` — **admin**

Dry-run a URL before saving it. Fetches and parses, stores nothing.

```json
{ "ok": true, "sourceType": "icloud", "eventCount": 42,
  "occurrenceCount": 137, "sample": [{ "summary": "…", "startsAt": 1789… }] }
```

---

## People

Household members: who a feed belongs to, and who the camera will one day
recognise. Birthdays are **not** here — see below.

`GET /api/people` → `{ "people": [Person, …] }`

`POST /api/people` — **admin** — `{ displayName, email?, color?, active? }` → **201**

`PATCH /api/people/:id` — **admin** — any subset

`DELETE /api/people/:id` — **admin** → **204**. Feeds survive; the link is dropped.

---

## Birthdays

A separate set from People, deliberately. The names here are grandparents,
cousins and school friends — nobody whose calendar is subscribed to and nobody
the camera will ever see — so they carry only what a birthday needs.

`GET /api/birthdays` → `{ "birthdays": [Birthday, …] }`, in calendar order.

`POST /api/birthdays` — **admin** — `{ displayName, date, icon?, color?, active? }` → **201**

`PATCH /api/birthdays/:id` — **admin** — any subset

`DELETE /api/birthdays/:id` — **admin** → **204**

```json
{
  "id": "b2…",
  "displayName": "Ada",
  "date": { "month": 9, "day": 9, "year": 2017 },
  "icon": "bi-balloon",
  "color": "#d63384",
  "active": true,
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-09-01T10:00:00.000Z"
}
```

`date` is a civil date, not an instant, so it is sent as its parts. `month` and
`day` are required; `year` may be `null` or omitted, which shows the day on the
calendar without an age. A patch omitting `date` leaves it alone — there is no
way to clear it, since a birthday without a date is not a record.

`icon` is a Bootstrap Icons class name matching `bi-[a-z0-9-]+` (default
`bi-cake2`); `color` tints the entry on the calendar (default `#d63384`).
`active: false` keeps the record but takes it off the calendar.

---

## Presence _(camera, future)_

### `GET /api/presence`

```json
{
  "present": [
    {
      "personId": "…",
      "displayName": "Alice",
      "color": "#123456",
      "lastSeenAt": "2026-09-06T16:47:10.000Z",
      "confidence": 0.92
    }
  ],
  "windowSeconds": 300,
  "evaluatedAt": "2026-09-06T16:48:22.001Z"
}
```

Most recent sighting per active person, provided it landed inside
`PRESENCE_WINDOW_SECONDS` and scored at least 0.5.

### `POST /api/presence/sightings` — **admin**

```json
{
  "personId": "uuid",
  "confidence": 0.92,
  "source": "camera",
  "cameraId": "front",
  "detectedAt": "2026-09-06T16:47:10.000Z"
}
```

Only `personId` is required. `source` is `camera` | `manual` | `schedule`;
`detectedAt` defaults to now, and exists so a detector can batch delayed
results. → **201** `{ "sighting": PresenceSighting }`

This is the whole contract the camera work has to satisfy. Sightings are
append-only and pruned after seven days.
