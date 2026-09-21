-- Chores: who does what, and on which day.
--
-- A task names a *day* rather than an instant, so its dates are `YYYY-MM-DD`
-- keys and not the unix seconds the event tables use. This is the third time
-- the schema takes that exception, after birthdays and menus, and for the same
-- reason: nobody takes the bins out at 18:42, they take them out on Thursday
-- morning, and an epoch anchor would have a display east of UTC asking for it
-- on Wednesday.
--
-- Recurring tasks are **not** materialised. A schedule here is a handful of
-- integers that generate a day key by arithmetic, exactly as a birthday does,
-- so expanding one into rows would cost writes on every window roll while
-- capping a chore at a window it has no reason to respect. `util/tasks.ts`
-- derives the days per request, which is also what keeps a steady-state sync
-- writing nothing at all.

CREATE TABLE task (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  -- Who does it. Nullable because "whoever is about" is how a household
  -- actually assigns half its work, and a chore with no name on it is still a
  -- chore — the board gives those a column of their own rather than dropping
  -- them. `SET NULL` rather than `CASCADE` for the same reason a wish keeps
  -- its dish when the asker leaves: somebody moving out does not mean the bins
  -- stop needing to go out, and the task should land in front of the household
  -- to be reassigned rather than vanish with them.
  person_id   TEXT REFERENCES person (id) ON DELETE SET NULL,
  note        TEXT,
  -- Coarse on purpose. A household runs on "before school" and "after school",
  -- and a clock time would invite somebody to be five minutes late for the
  -- washing up.
  daypart     TEXT NOT NULL DEFAULT 'morning'
                CHECK (daypart IN ('morning', 'afternoon')),
  -- Bootstrap icon class and a colour, the same pair birthdays and dishes
  -- carry. On a column read from across a room the icon is what identifies a
  -- chore before the words are legible.
  icon        TEXT NOT NULL DEFAULT 'bi-check2-square',
  color       TEXT NOT NULL DEFAULT '#4c6ef5',

  -- `once` is a frequency rather than a separate kind of row, which is what
  -- lets one table, one derivation and one completion key serve both. A
  -- one-off is then a schedule that happens to produce a single day.
  frequency   TEXT NOT NULL DEFAULT 'once'
                CHECK (frequency IN ('once', 'weekly', 'monthly')),
  -- Every n-th week or month: 2 is "every other week". Ignored for a one-off,
  -- where there is no second occurrence for an interval to count towards.
  interval    INTEGER NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 12),
  -- Which days a weekly task lands on, as a sorted comma-separated list of
  -- Monday-first indices — `0,3` is Monday and Thursday. Text rather than a
  -- bitmask because the value is read straight out of a SQL console when
  -- something looks wrong, and a mask is a puzzle at exactly that moment.
  -- More than one day is ordinary: "bins on Tuesday and Friday" is one chore.
  weekdays    TEXT NOT NULL DEFAULT '',

  -- Two jobs, and they are the same job: for a one-off this is the day, and
  -- for anything recurring it is the day the pattern is counted from. That is
  -- what makes "every other week" answerable — without an anchor, which of two
  -- weeks is the odd one has no answer — and it is also where a monthly task
  -- gets its date, so there is no second column to contradict it.
  starts_on   TEXT NOT NULL
                CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- The last day it runs, or NULL for one that runs until somebody retires it.
  -- A term-time chore ends when term does, and a task that quietly stops is
  -- better than one somebody has to remember to delete.
  ends_on     TEXT
                CHECK (ends_on IS NULL
                       OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- Retired rather than deleted, so a chore nobody does any more drops off the
  -- board without erasing the mornings somebody did do it.
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- The board's read is "every task that could fall in this window", which is
-- every active task whose run has started and not yet ended. A household has
-- tens of these, so this index is about keeping retired and future tasks out
-- of the derivation rather than about scan size.
CREATE INDEX idx_task_active ON task (active, starts_on);

-- A task ticked off on a day.
--
-- Keyed by the pair, because completion belongs to the occurrence and not to
-- the task: Monday's bins being out is not a statement about next Monday's,
-- and a flag on `task` would have one Thursday silently tick the next.
--
-- `completed_at` is the instant, in unix seconds like every other timestamp
-- here — *when* something was done is a moment ("at 7:40, before school"),
-- unlike *which day* it was due, which is a civil date. The two sit in one row
-- deliberately: the day key is the question and the timestamp is the answer.
--
-- Not pruned. Unlike a grocery tick, which is made against a line that stops
-- existing the moment the meal is eaten, this row is owned by a task and
-- cascades away with it — and a household's chores are a few rows a day, which
-- is a page of SD card a year in exchange for being able to say when the bins
-- last went out.
CREATE TABLE task_completion (
  task_id      TEXT NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  day_key      TEXT NOT NULL
                 CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, day_key)
);

-- The board asks "what was ticked between these two day keys" once per load,
-- across every task at once. Day keys sort chronologically as text by
-- construction, so a leading `day_key` makes that one range scan — the same
-- property the agenda's occurrence query and the menu's both lean on.
CREATE INDEX idx_task_completion_day ON task_completion (day_key);
