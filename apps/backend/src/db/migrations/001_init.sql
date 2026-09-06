-- Core schema. All timestamps are INTEGER unix seconds in UTC so that range
-- scans are plain integer comparisons against a b-tree index.

CREATE TABLE person (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT,
  color         TEXT NOT NULL DEFAULT '#6c757d',
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_person_email ON person (email) WHERE email IS NOT NULL;

CREATE TABLE feed (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  source_type              TEXT NOT NULL CHECK (source_type IN ('sportsengine', 'icloud', 'ics')),
  url                      TEXT NOT NULL,
  enabled                  INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  color                    TEXT NOT NULL DEFAULT '#0d6efd',
  refresh_interval_seconds INTEGER NOT NULL DEFAULT 900,
  -- Conditional-request cache so an unchanged feed costs one 304 round trip.
  http_etag                TEXT,
  http_last_modified       TEXT,
  -- Hash of the last body we parsed; guards against servers ignoring ETags.
  content_hash             TEXT,
  last_status              TEXT NOT NULL DEFAULT 'pending'
                             CHECK (last_status IN ('pending', 'ok', 'error')),
  last_synced_at           INTEGER,
  last_error               TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_feed_url ON feed (url);
-- The scheduler asks "which enabled feed is due?" on every tick.
CREATE INDEX idx_feed_due ON feed (enabled, last_synced_at);

-- Many-to-many: a shared family calendar can belong to several people, and a
-- person can have several feeds. Drives the future presence-based filtering.
CREATE TABLE feed_person (
  feed_id   TEXT NOT NULL REFERENCES feed (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  PRIMARY KEY (feed_id, person_id)
);

CREATE INDEX idx_feed_person_person ON feed_person (person_id);

-- The event as authored in the source calendar. For a recurring series this is
-- the master row; `rrule` is kept so the series can be re-expanded when the
-- materialisation window rolls forward.
CREATE TABLE event (
  id             TEXT PRIMARY KEY,
  feed_id        TEXT NOT NULL REFERENCES feed (id) ON DELETE CASCADE,
  uid            TEXT NOT NULL,
  -- Set for a modified instance of a series (RECURRENCE-ID), else ''.
  recurrence_id  TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '(no title)',
  description    TEXT,
  location       TEXT,
  url            TEXT,
  organizer      TEXT,
  status         TEXT,
  all_day        INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  starts_at      INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL,
  timezone       TEXT,
  rrule          TEXT,
  sequence       INTEGER NOT NULL DEFAULT 0,
  source_updated_at INTEGER,
  -- Hash of the normalised event; lets a re-sync skip untouched rows.
  content_hash   TEXT NOT NULL,
  -- Bumped on every sync that still sees this UID, so deletions are detectable.
  last_seen_sync TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_event_identity ON event (feed_id, uid, recurrence_id);
CREATE INDEX idx_event_feed ON event (feed_id);

-- One row per concrete instance shown on the dashboard. Recurring series are
-- expanded here at ingest time so the agenda query never evaluates an RRULE.
CREATE TABLE event_occurrence (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  feed_id    TEXT NOT NULL REFERENCES feed (id) ON DELETE CASCADE,
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  all_day    INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1))
);

-- The dashboard's only hot query: occurrences overlapping [now, now + 8 days).
-- Leading `starts_at` makes it a range scan; `feed_id` lets the optional feed
-- filter be satisfied from the index without touching the table.
CREATE INDEX idx_occurrence_window ON event_occurrence (starts_at, ends_at, feed_id);
CREATE INDEX idx_occurrence_event ON event_occurrence (event_id);

CREATE TABLE sync_run (
  id              TEXT PRIMARY KEY,
  feed_id         TEXT NOT NULL REFERENCES feed (id) ON DELETE CASCADE,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error')),
  events_upserted INTEGER NOT NULL DEFAULT 0,
  events_deleted  INTEGER NOT NULL DEFAULT 0,
  message         TEXT
);

CREATE INDEX idx_sync_run_feed ON sync_run (feed_id, started_at DESC);

-- Written by the (future) on-device camera detector. Kept append-only so the
-- room's occupancy history can be analysed later; the "who is here now" query
-- reads only the tail.
CREATE TABLE presence_sighting (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  detected_at INTEGER NOT NULL,
  confidence  REAL NOT NULL DEFAULT 1.0,
  source      TEXT NOT NULL DEFAULT 'camera'
                CHECK (source IN ('camera', 'manual', 'schedule')),
  camera_id   TEXT
);

CREATE INDEX idx_presence_recent ON presence_sighting (detected_at DESC);
CREATE INDEX idx_presence_person ON presence_sighting (person_id, detected_at DESC);

-- Small key/value bag for runtime state that does not deserve a table, e.g.
-- the agenda revision counter the dashboard polls against.
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
