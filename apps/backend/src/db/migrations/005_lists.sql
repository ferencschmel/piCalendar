-- Lists the household keeps, and the ticks against the one it does not keep.
--
-- Two kinds, and only one of them has rows here. A *custom* list is typed in,
-- so it is stored. The *grocery* list is the ingredients of everything planned
-- for the next few days, added up — it is derived from `menu_entry` on every
-- request and has no table at all, for the same reason birthdays and menus are
-- not materialised into occurrences: it names what is already written down
-- elsewhere, and a stored copy would be a second answer to invalidate.
--
-- Nothing here is written by ingest. These tables change when somebody writes
-- a list or ticks a line, which is a handful of writes a week.

CREATE TABLE list (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  -- The order the index page draws them: the order they were made, which is
  -- the order a household remembers them in.
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Two lists called "Hardware" a month apart is a household that has forgotten
-- about the first one, not a household that wanted two.
CREATE UNIQUE INDEX idx_list_name ON list (name COLLATE NOCASE);

CREATE INDEX idx_list_position ON list (position);

-- An item is an ingredient plus a tick. Same columns as `dish_ingredient` on
-- purpose: "2 kg potatoes" is the same thought whether it was typed onto a
-- list or read off a recipe, and the shared shape is what lets the two be
-- added together without a translation step.
CREATE TABLE list_item (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES list (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  -- Nullable rather than zero, exactly as on a recipe: "milk" with no number
  -- is a real line on a shopping list, and "0 milk" is not what it meant.
  quantity   REAL,
  unit       TEXT NOT NULL DEFAULT '',
  -- The instant it was ticked, or NULL for an open item. A timestamp rather
  -- than a flag because "when did we buy this" is the question that follows.
  checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_list_item_list ON list_item (list_id, position);

-- A tick against a line of the grocery list.
--
-- Keyed by the case-folded ingredient name, because that is the only identity
-- a derived line has — it is recomputed from the menu on every request and
-- holds no id of its own. Folding the case is what stops "Onion" bought on
-- Tuesday reappearing as "onion" on Thursday.
--
-- `signature` records what was ticked: the amount, and the last day it was
-- needed for. A tick means "I have bought this", and what was bought is an
-- amount for a set of days — change either and the tick no longer describes
-- the line it sits on, so the item comes back unticked. That errs towards
-- asking a shopper to look twice, which is the safe direction.
CREATE TABLE grocery_check (
  name_key   TEXT PRIMARY KEY,
  signature  TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

-- Rows outlive the list they were ticked on — an ingredient drops off as soon
-- as the meal is eaten, taking nothing with it — so the table is pruned by age
-- whenever a tick is written. This index is what makes that a range delete
-- rather than a scan.
CREATE INDEX idx_grocery_check_age ON grocery_check (checked_at);
