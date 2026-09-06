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

| Query param | Default | Notes                                         |
| ----------- | ------- | --------------------------------------------- |
| `start`     | today   | `YYYY-MM-DD` in `DISPLAY_TIMEZONE`            |
| `days`      | `8`     | 1–31, including the start day                 |
| `personId`  | —       | Repeatable. Restricts to those people's feeds |
| `feedId`    | —       | Repeatable                                    |

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
      ]
    }
  ]
}
```

`revision` changes only when ingest actually wrote something. Compare it across
polls to decide whether a re-render is warranted.

A multi-day event appears under **every** day it covers. One ending exactly at
midnight belongs to the earlier day only.

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

`GET /api/people` → `{ "people": [Person, …] }`

`POST /api/people` — **admin** — `{ displayName, email?, color?, active? }` → **201**

`PATCH /api/people/:id` — **admin** — any subset

`DELETE /api/people/:id` — **admin** → **204**. Feeds survive; the link is dropped.

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
