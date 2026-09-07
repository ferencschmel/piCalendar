-- Birthdays.
--
-- A table of its own rather than columns on `person`, because the two are not
-- the same set of people. A `person` is a member of the household that feeds
-- are attributed to and that the camera will one day recognise; the
-- grandparents, cousins and school friends whose birthdays a family calendar
-- carries are none of those things, and `person` rows for them would land them
-- in the presence set and the feed-attribution picker for no reason.
--
-- The date is stored as its parts rather than as the unix seconds the rest of
-- the schema uses: there is no timezone at which someone stops having been born
-- on the 3rd of March, and an epoch anchor would make a display east of UTC
-- celebrate a day early. Month and day are NOT NULL — a birthday row without a
-- date is nothing at all — while the year is separately nullable, because a
-- household knows when to wish a neighbour happy birthday without knowing how
-- old they are turning.
--
-- No index: this table holds a family's worth of rows and every read wants all
-- of them. An index here would only cost writes on the SD card.
CREATE TABLE birthday (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  birth_month  INTEGER NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_day    INTEGER NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_year   INTEGER CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2200),
  -- Bootstrap icon class rendered beside the name on the calendar.
  icon         TEXT NOT NULL DEFAULT 'bi-cake2',
  color        TEXT NOT NULL DEFAULT '#d63384',
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
