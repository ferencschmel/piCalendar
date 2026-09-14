-- Menu planning: a library of dishes, a household wishlist, and which dishes
-- are planned for which day.
--
-- The day a dish is planned for is a *civil* date, stored as a `YYYY-MM-DD`
-- key rather than as the unix seconds the rest of the schema uses. This is the
-- exception birthdays already take, for the same reason: Wednesday's dinner is
-- Wednesday's dinner, and anchoring it to an instant would have a display east
-- of UTC serving it on Tuesday. It also means a menu is known outside the
-- occurrence window, so a meal planned for a fortnight out still draws on a
-- month grid where no feed has been expanded yet.
--
-- Nothing here is written by ingest. These tables change only when a person
-- plans a meal, which is a handful of writes a week — a steady-state sync
-- still writes nothing at all.

CREATE TABLE dish (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  -- Free prose, the way it would be written on a recipe card. Never parsed;
  -- the kitchen reads it, nothing else does.
  recipe         TEXT,
  -- Where it came from, so a phone can open the original mid-cook.
  source_url     TEXT,
  -- What this dish usually is, so dropping it on a day asks no second
  -- question. Overridable per entry: last night's main is tonight's side.
  default_course TEXT NOT NULL DEFAULT 'main'
                   CHECK (default_course IN ('starter', 'soup', 'main',
                                             'side', 'dessert', 'drink')),
  icon           TEXT NOT NULL DEFAULT 'bi-egg-fried',
  color          TEXT NOT NULL DEFAULT '#1b6a57',
  -- Retired rather than deleted, so a dish nobody wants any more drops out of
  -- the picker without erasing the evenings it was served on.
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- One row per dish by name. Without it two people adding "Gulyás" a month apart
-- end up with two libraries' worth of near-duplicates and no way to tell which
-- one carries the recipe.
CREATE UNIQUE INDEX idx_dish_name ON dish (name COLLATE NOCASE);

CREATE TABLE dish_ingredient (
  id       TEXT PRIMARY KEY,
  dish_id  TEXT NOT NULL REFERENCES dish (id) ON DELETE CASCADE,
  -- The order they were typed, which for a recipe is the order they are used.
  position INTEGER NOT NULL,
  name     TEXT NOT NULL,
  -- Free text — "2 dl", "a pinch", "3 large". A household measures in words,
  -- and a quantity/unit pair would put a unit picker on a touchscreen to serve
  -- a scaling feature nobody has asked for.
  amount   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_dish_ingredient_dish ON dish_ingredient (dish_id, position);

-- The wishlist: dishes someone has asked for, waiting for a day.
CREATE TABLE menu_wish (
  id         TEXT PRIMARY KEY,
  dish_id    TEXT NOT NULL REFERENCES dish (id) ON DELETE CASCADE,
  -- Who asked. Nullable because the display has no sign-in, and a dish dragged
  -- across without stopping to pick a name is still a wish worth honouring.
  person_id  TEXT REFERENCES person (id) ON DELETE SET NULL,
  note       TEXT,
  created_at INTEGER NOT NULL
);

-- One wish per person per dish. Two children both wanting pizza should read as
-- two names, not as one row that lost whoever asked first. NULL is folded to ''
-- because SQLite treats two NULLs as distinct in a unique index, which would
-- let the anonymous wish pile up.
CREATE UNIQUE INDEX idx_menu_wish_unique
  ON menu_wish (dish_id, COALESCE(person_id, ''));

CREATE INDEX idx_menu_wish_recent ON menu_wish (created_at DESC);

-- A dish planned for a meal on a day. See the note at the top of this file for
-- why the day is a text key and not an instant.
--
-- Two axes, because a day is not a flat list: `meal` says when it is eaten and
-- `course` says what it is within that meal. A soup at lunch and a soup at
-- dinner are different plans, and flattening them would make the wall display
-- read "soup, soup" with no way to tell which was which.
CREATE TABLE menu_entry (
  id         TEXT PRIMARY KEY,
  day_key    TEXT NOT NULL
               CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  dish_id    TEXT NOT NULL REFERENCES dish (id) ON DELETE CASCADE,
  meal       TEXT NOT NULL DEFAULT 'dinner'
               CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
  course     TEXT NOT NULL CHECK (course IN ('starter', 'soup', 'main',
                                             'side', 'dessert', 'drink')),
  -- Explicit rather than derived from `course`, because a meal can hold two
  -- sides and the order they reach the table is not the enum's.
  position   INTEGER NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per dish per sitting. Scoped to the meal rather than the day, so the
-- same dish on Monday and again on Thursday is ordinary, and yesterday's stew
-- reheated for lunch and served again at dinner is too. What it catches is a
-- second tap on a touchscreen, which the API answers with the entry already
-- there rather than an error.
CREATE UNIQUE INDEX idx_menu_entry_unique ON menu_entry (day_key, meal, dish_id);

-- The dashboard's menu query is "every entry between these two day keys",
-- which a leading `day_key` makes a range scan over text that sorts
-- chronologically by construction.
CREATE INDEX idx_menu_entry_day ON menu_entry (day_key, meal, position);
-- "When did we last cook this?", shown beside every dish in the library.
CREATE INDEX idx_menu_entry_dish ON menu_entry (dish_id, day_key DESC);
