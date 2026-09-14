-- Ingredients get a quantity and a unit instead of one free-text amount.
--
-- The original column held whatever a cook typed — "500 g", "3 large", "a
-- pinch" — which reads fine on a recipe card and is useless to anything else.
-- Splitting it is what lets the editor suggest the unit an ingredient is
-- usually measured in, and it is the shape a shopping list would need to add
-- two entries of the same thing together.
--
-- `quantity` is nullable rather than defaulted to zero, because "a pinch of
-- salt" and "parsley, to taste" are real lines in a real recipe and "0 pinch"
-- is not what anybody meant. `unit` stays free text with a suggested list in
-- the editor rather than becoming a CHECK constraint: a household measures in
-- cloves, tins and bunches, and an enum would reject the ingredient rather
-- than the typo.

ALTER TABLE dish_ingredient ADD COLUMN quantity REAL;
ALTER TABLE dish_ingredient ADD COLUMN unit TEXT NOT NULL DEFAULT '';

-- Split what is already there on the first space. `CAST` stops at the first
-- non-numeric character, so "500 g" yields 500 — but it also yields 0 for text
-- with no leading digit, which is why the GLOB guards the numeric branch
-- rather than trusting the cast.
UPDATE dish_ingredient
SET quantity = CASE WHEN amount GLOB '[0-9]*' THEN CAST(amount AS REAL) END,
    unit = CASE
             WHEN amount GLOB '[0-9]* *' THEN TRIM(SUBSTR(amount, INSTR(amount, ' ') + 1))
             WHEN amount GLOB '[0-9]*' THEN ''
             -- No leading number at all: the whole thing was the measure.
             ELSE TRIM(amount)
           END
WHERE TRIM(amount) != '';

ALTER TABLE dish_ingredient DROP COLUMN amount;

-- The editor's autocomplete groups by name, and the suggestion list is read on
-- every keystroke in a blank ingredient row.
CREATE INDEX idx_dish_ingredient_name ON dish_ingredient (name COLLATE NOCASE);
