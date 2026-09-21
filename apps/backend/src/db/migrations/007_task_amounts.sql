-- What a chore is worth, and what that added up to.
--
-- Pocket money is the reason a household writes chores down at all, and the
-- question it is eventually asked is "how much did I earn this month". That
-- question has to survive the board being edited, which is what the second half
-- of this file is about.

-- Minor units, never a REAL. Money is counted, not measured, and 0.1 + 0.2 is
-- a conversation nobody wants to have about somebody's pocket money. Every
-- amount in the codebase is therefore an integer of cents and only ever becomes
-- a decimal on its way onto a screen.
--
-- Zero by default, which is also the default a household that does not pay for
-- chores never has to think about: nothing in the UI shows an amount it does
-- not have, so the feature is invisible until somebody sets a price.
ALTER TABLE task ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0
  CHECK (amount_cents >= 0);

-- The two columns that make a tick a *ledger entry* rather than a pointer.
--
-- Both are snapshots taken server-side at the moment of the tick, and that is
-- the whole point. Joining the sum back to `task` live would mean raising the
-- bins from 50c to $1 in September silently re-pricing every March bin — and
-- reassigning the chore to a sibling handing them a month of somebody else's
-- earnings. Neither is arguable at a kitchen table: what a chore paid, and who
-- it paid, were settled on the day it was done.
--
-- The cost is two columns on a row already being written, and the derivation
-- stays honest without a second table.
ALTER TABLE task_completion ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0
  CHECK (amount_cents >= 0);

-- `SET NULL` rather than `CASCADE`, the same call `task.person_id` makes. A
-- person leaving the household does not unmake the work; the entry simply
-- stops having a name on it and falls in with the unassigned ones, which is
-- exactly what the board does with their chores.
ALTER TABLE task_completion ADD COLUMN person_id TEXT
  REFERENCES person (id) ON DELETE SET NULL;

-- Ticks that predate this file. They were free — there was no price to record
-- — but they *were* done by somebody, and leaving the column NULL would file a
-- year of history under "Anyone" the first time this page is opened.
UPDATE task_completion
   SET person_id = (SELECT person_id FROM task WHERE task.id = task_completion.task_id);

-- The earnings read is "every tick in this month, grouped by who". The day
-- index already makes the month a range scan — day keys sort chronologically
-- as text by construction — and this one keeps the grouping from re-reading
-- the table per person.
CREATE INDEX idx_task_completion_person ON task_completion (person_id, day_key);
