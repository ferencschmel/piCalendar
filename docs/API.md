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
      "birthdays": [],
      "menu": [
        {
          "entryId": "e4…",
          "dishId": "d7…",
          "name": "Gulyás",
          "meal": "dinner",
          "course": "main",
          "icon": "bi-fire",
          "color": "#b4472a",
          "note": null,
          "hasRecipe": true
        }
      ]
    }
  ]
}
```

`revision` changes when ingest wrote something, when a birthday record was
added, edited or removed, and when a menu did — neither is ingested, so a client
that skips repaints on an unchanged revision would otherwise miss them. Compare
it across polls to decide whether a re-render is warranted.

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

## Dishes

The library of what the household knows how to cook. **Not admin-gated**, and
that is deliberate: `ADMIN_TOKEN` exists to stop a passer-by editing which
calendars the house subscribes to, while adding a dish at the fridge is the
interaction this feature is for — and the wall display holds no token.

`GET /api/dishes` → `{ "dishes": [Dish, …] }`, by name, retired ones last.

`GET /api/dishes/:id` → `{ "dish": Dish }`

`POST /api/dishes` — `{ name, recipe?, sourceUrl?, defaultCourse?, icon?, color?, active?, ingredients? }` → **201**

`PATCH /api/dishes/:id` — any subset

`DELETE /api/dishes/:id` → `{ "removed": { "timesCooked": 2, "wishCount": 1 } }`

```json
{
  "id": "d7…",
  "name": "Gulyás",
  "recipe": "Brown the onions slowly in lard…",
  "sourceUrl": "https://example.com/gulyas",
  "defaultCourse": "main",
  "icon": "bi-fire",
  "color": "#b4472a",
  "active": true,
  "ingredients": [
    { "name": "Beef shin", "quantity": 500, "unit": "g" },
    { "name": "Salt", "quantity": null, "unit": "pinch" }
  ],
  "lastCookedOn": "2026-09-11",
  "timesCooked": 2,
  "wishedBy": [{ "wishId": "w2…", "personId": "p1…", "displayName": "Bea" }],
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-09-01T10:00:00.000Z"
}
```

`ingredients` is sent **whole** and replaced whole; the array's order is the
stored position. Omitting it on a `PATCH` leaves the existing set alone, and
sending `[]` clears it.

`quantity` is nullable rather than defaulted to zero — "salt, a pinch" and
"parsley, to taste" are real lines, and `0` is not what leaving the number off
meant. `unit` is **free text** (≤ 20 chars), not an enum: a household measures
in cloves, tins and bunches, so the editor offers `SUGGESTED_UNITS` (`g`, `kg`,
`oz`, `lbs`, `ml`, `dl`, `l`, `tsp`, `tbsp`, `cup`, `each`, …) and accepts
anything.

### `GET /api/dishes/ingredients`

Every distinct ingredient across the whole library, for the editor's
autocomplete. Commonest first.

```json
{
  "ingredients": [
    { "name": "Onion", "unit": "each", "uses": 7 },
    { "name": "Beef shin", "unit": "g", "uses": 2 }
  ]
}
```

Names are folded case-insensitively, so "Onion" and "onion" are one suggestion
— the list exists to stop a library growing three unrelated spellings of the
same thing, and would defeat itself by offering them.

`unit` is the most-used **non-empty** unit for that name: a blank is the absence
of an answer rather than an answer, so four unmeasured uses do not outvote the
one dish that says grams. The editor fills it in when a known name is chosen,
but only into a blank unit field, so it never overwrites a deliberate choice.

> Registered before `/api/dishes/:id`. Express matches in order, and the
> parameterised route would otherwise look for a dish called "ingredients".

`lastCookedOn`, `timesCooked` and `wishedBy` are derived, never stored.

A duplicate `name` answers **409** with the existing dish in the body, so a
client can offer to open it rather than leaving the cook retyping. `active:
false` retires a dish: it keeps every evening it was served on but drops out of
the planner. Deleting cascades to those evenings, which is why the response says
what it took.

---

## Menu

What is planned to be eaten, and the wishlist it gets planned from. Open, for
the same reason Dishes are.

| Route                         | Body                                                 | Notes                                              |
| ----------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `GET /api/menu?start=&days=`  | —                                                    | `start` defaults to today, `days` 1–31 (default 7) |
| `POST /api/menu`              | `{ dayKey, dishId, meal?, course?, note?, wishId? }` | **201**                                            |
| `PATCH /api/menu/:id`         | `{ dayKey?, meal?, course?, note? }`                 | Moving days or meals                               |
| `DELETE /api/menu/:id`        | —                                                    | **204**                                            |
| `GET /api/menu/wishes`        | —                                                    | Newest first                                       |
| `POST /api/menu/wishes`       | `{ dishId, personId?, note? }`                       | **201**, or **200** if already wished              |
| `DELETE /api/menu/wishes/:id` | —                                                    | **204**                                            |

```json
{
  "generatedAt": "2026-09-13T16:48:22.001Z",
  "timezone": "Europe/Budapest",
  "revision": "8.1789325161.1789325160",
  "days": [
    {
      "date": "2026-09-14",
      "isToday": true,
      "entries": [{ "entryId": "e4…", "name": "Gulyás", "meal": "dinner", "course": "main" }]
    }
  ]
}
```

`dayKey` is a `YYYY-MM-DD` **civil date**, not an instant: Wednesday's dinner is
Wednesday's dinner in every timezone, and nothing on the server converts one.
This also means a menu is readable for any date, not only inside the occurrence
window that bounds feed events.

`meal` is `breakfast` | `lunch` | `dinner` (default `dinner`) and `course` is
`starter` | `soup` | `main` | `side` | `dessert` | `drink`. Omitting `course`
takes the dish's own `defaultCourse`, so planning is one decision rather than
two. Entries come back in serving order — meal, then course — whatever order
they were planned in.

Passing `wishId` to `POST /api/menu` **fulfils that wish in the same
transaction**: a planned dish still sitting on the wishlist would read as
"nobody has acted on this".

The same dish on as many **days** as a household likes is ordinary — a pot of
something eaten on Monday and again on Thursday — and so is the same dish at a
different **meal** on the same day. Neither is a conflict and neither is
refused.

The same dish at the _same_ sitting twice is a second tap, not an intention, so
it comes back as the entry that is already there: **200** with
`alreadyPlanned: true`, never an error. Nothing the person asked for is missing
— the dish is planned — so there is nothing to warn about. Wishing twice
behaves the same way, with `alreadyWished: true`.

`PATCH` is how a dish moves between days, so the entry keeps its identity and a
failed move cannot leave it on neither day.

---

## Lists

The grocery list, and whatever else the household writes down. Open, for the
same reason Dishes and Menu are: the phone in the supermarket holds no token.

| Route                                           | Body                                   | Notes                                                |
| ----------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `GET /api/lists`                                | —                                      | Card summaries; the grocery list is always first     |
| `GET /api/lists/grocery?start=&days=`           | —                                      | `start` defaults to today, `days` 1–31 (default 7)   |
| `POST /api/lists/grocery/checks?start=&days=`   | `{ key, checked }`                     | Ticks one line, returns the refreshed list           |
| `DELETE /api/lists/grocery/checks?start=&days=` | —                                      | Every tick off, returns the refreshed list           |
| `GET /api/lists/:id`                            | —                                      | One custom list with its items                       |
| `POST /api/lists`                               | `{ name }`                             | **201**, or **409** naming the list already there    |
| `PATCH /api/lists/:id`                          | `{ name? }`                            | Rename                                               |
| `DELETE /api/lists/:id`                         | —                                      | **204**; cascades to the items                       |
| `POST /api/lists/:id/items`                     | `{ name, quantity?, unit?, checked? }` | **201**, appended                                    |
| `PATCH /api/lists/:id/items/:itemId`            | same fields, all optional              | Ticking is a patch of `checked`                      |
| `DELETE /api/lists/:id/items/:itemId`           | —                                      | **204**                                              |
| `POST /api/lists/:id/items/clear-checked`       | —                                      | Removes the ticked ones; returns `{ list, removed }` |

### The grocery list is derived

It is **not** a row in `list`. It is the ingredients of every dish planned in
the window, added up, recomputed on every request — so `id` is the literal
string `grocery`, the mutating routes above cannot reach it (they answer
**404**), and there is nothing on it to edit. That is deliberate: a line typed
on top of it would be a second answer that silently wins over the menu.

```json
{
  "generatedAt": "2026-09-14T00:52:21.422Z",
  "timezone": "Europe/Budapest",
  "start": "2026-09-14",
  "end": "2026-09-20",
  "days": 7,
  "dishCount": 4,
  "checkedCount": 1,
  "items": [
    {
      "key": "onion",
      "name": "Onion",
      "amounts": [{ "quantity": 11, "unit": "each" }],
      "amount": "11 each",
      "firstNeededOn": "2026-09-14",
      "lastNeededOn": "2026-09-19",
      "dishes": ["Baked salmon", "Beef stew", "Onion soup"],
      "checked": false
    }
  ]
}
```

`lastNeededOn` is the last day a meal calls for the item, and it is the number
the shopper actually needs: it is how long the thing has to keep, and therefore
whether to buy the fish fresh today, buy it frozen, or come back. Every date
here is a civil day key and nothing in this path converts one.

Quantities are summed within a unit scale and never across systems — `500 g`
plus `1 kg` is `1.5 kg`, but grams and ounces stay as two parts, because which
answer is right depends on whose kitchen it is. Anything unrecognised groups
under its own spelling, so `3 clove` and `2 tin` add up sensibly too.

### Ticks

A tick is keyed by the case-folded ingredient name — the only identity a
derived line has — and is stored with a **signature**: the amount, and
`lastNeededOn`. A tick means "I have bought this", and what was bought is an
amount for a set of days. Change either, by planning another meal or by
shopping for a longer window, and the item comes back **unticked**, because the
tick no longer describes the line it sits on. That errs towards asking a
shopper to look twice, which is the safe direction.

The signature is derived on the server from the list as it currently stands and
is never taken from the request. Ticking a line that is no longer on the list
is a **404** rather than a silently stored row that matches nothing.

---

## Tasks

Chores, and who they belong to. Open, for the same reason Dishes, Menu and
Lists are: ticking off the bins is what the feature is for, and a wall display
that needed a sign-in would not get used.

| Route                                  | Body                      | Notes                                                    |
| -------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `GET /api/tasks?day=`                  | —                         | The board; `day` defaults to today in `DISPLAY_TIMEZONE` |
| `POST /api/tasks/:id/completions?day=` | `{ dayKey, completed }`   | Ticks one day off, returns the refreshed board           |
| `GET /api/tasks/definitions`           | —                         | The task rows themselves, retired ones included          |
| `GET /api/tasks/definitions/:id`       | —                         | One task plus `lastCompletedOn`                          |
| `POST /api/tasks`                      | task fields               | **201**                                                  |
| `PATCH /api/tasks/:id`                 | same fields, all optional | **422** when the _merged_ schedule contradicts itself    |
| `DELETE /api/tasks/:id`                | —                         | **204**; cascades to the completions                     |

### A task names a day, not an instant

Every date on a task — `startsOn`, `endsOn`, the day it is due, the day it was
ticked for — is a `YYYY-MM-DD` key. This is the third time the API takes that
exception, after birthdays and menus, and for the same reason: nobody takes the
bins out at 18:42, and an epoch anchor would have a display east of UTC asking
for it a day early. Only `completedAt` is an instant, because _when_ something
was done is a moment.

### The schedule

```json
{
  "frequency": "once | weekly | monthly",
  "interval": 2,
  "weekdays": [0, 3],
  "startsOn": "2026-03-02",
  "endsOn": null
}
```

`once` is a frequency rather than a separate kind of row, which is what lets one
table, one derivation and one completion key serve both.

`weekdays` is Monday-first (`0` = Monday), matching the month and year grids,
and applies to `weekly` only. `interval` is "every n-th": `2` is every other
week, and it counts **between the Mondays** of the anchor's week and the
candidate's, so an anchor mid-week does not shift the phase.

`startsOn` does two jobs and they are the same job: for a one-off it is the
day, and for anything recurring it is the day the pattern counts from. A
monthly task takes its date from it too — there is no separate day-of-month to
contradict it — and a month too short for that date clamps to its last day, so
a chore on the 31st still happens in February.

Recurring tasks are **not** materialised. `util/tasks.ts` derives the days per
request, exactly as birthdays and menus are derived, so a steady-state sync
still writes nothing and a chore is known outside the occurrence window.

### The board

One column per person, plus a last column for chores nobody is named on —
"whoever is about" is a real answer, and `personId: null` is how it is spelled.
Every active person gets a column even when it is empty; anyone else holding
work gets one too, so a person retired mid-week cannot take their chores off
the wall with them.

**Not narrowed by presence**, deliberately, in the way birthdays are not. The
agenda hides a calendar nobody is home for; a chore is the opposite — it is
waiting _because_ somebody is out.

### Overdue is bounded, and says so

`overdueFrom` is `TASK_OVERDUE_LOOKBACK_DAYS` (14) before the board's day.
Anything older is not known to be done — it is simply no longer asked about —
and reporting the window is what keeps an empty pile honest, the same
distinction `coverageStart`/`coverageEnd` preserve on the density endpoint.

Within that window there is **at most one overdue card per task**, carrying
`missedCount` and `missedSince`. A recurring chore is done once, not once per
day it was skipped, so a missed day earlier than the task's most recent tick is
dropped: doing the chore clears its backlog. Without that, ticking the pile
would appear to do nothing, and a daily chore missed for a fortnight would fill
a column with fourteen identical rows that push the day's own work off a screen
nobody can scroll.

### Completions

A tick is keyed by task **and** day, because completion belongs to the
occurrence: Monday's bins being out says nothing about next Monday's. The day
is part of the request rather than assumed to be today — the overdue pile is
full of other days — and a day the task does not fall on is a **404**, since
storing it would leave a row no derivation ever reads back.

Re-ticking the same day leaves the original `completedAt` alone. Nothing was
done twice.

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
