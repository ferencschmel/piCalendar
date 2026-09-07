import { birthdayLabel, type BirthdayCelebration } from '@picalendar/shared';

/**
 * Whose birthday it is, as a chip in that person's own colour.
 *
 * Not a button, unlike everything else on the grid: a birthday has no feed, no
 * time and no description, so there is nothing a detail popup could add that
 * the chip does not already say — and a tap target that does nothing is worse
 * than none. The icon is the person's own; at wall distance a household reads
 * the glyph and the hue well before it reads the name.
 */
export function BirthdayChip({ celebration }: { celebration: BirthdayCelebration }): JSX.Element {
  const label = birthdayLabel(celebration);
  // 29 February in a common year is drawn on the 28th; saying so is better than
  // showing a date the birth certificate disagrees with.
  const title = celebration.observed ? `${label} (born 29 February)` : label;

  return (
    <span className="birthday-chip" style={{ borderLeftColor: celebration.color }} title={title}>
      <i
        className={`bi ${celebration.icon} birthday-chip__icon`}
        style={{ color: celebration.color }}
        aria-hidden="true"
      />
      <span className="birthday-chip__name" aria-hidden="true">
        {celebration.displayName}
      </span>
      {celebration.age !== null && (
        <span className="birthday-chip__age" aria-hidden="true">
          {celebration.age}
        </span>
      )}
      {/* Read visually as icon + name + number; a screen reader gets the one
          sentence that shorthand stands for, rather than all three fragments. */}
      <span className="visually-hidden">{title}</span>
    </span>
  );
}
