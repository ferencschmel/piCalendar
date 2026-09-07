import type { CalendarOccurrence } from '@picalendar/shared';
import { timeLabel } from '../utils/datetime.js';

/** Opens the detail popup, handing it the element to be placed beside. */
export type SelectOccurrence = (
  key: string,
  occurrence: CalendarOccurrence,
  anchor: HTMLElement,
) => void;

interface Props {
  occurrence: CalendarOccurrence;
  /** Identifies this block on the board; the same occurrence can span days. */
  selectionKey: string;
  /** True while this block's detail popup is open. */
  isSelected: boolean;
  onSelect: SelectOccurrence;
  /** The occurrence started before this day — the block is cut off at the top. */
  continuesBefore: boolean;
  /** The occurrence runs past midnight — the block is cut off at the bottom. */
  continuesAfter: boolean;
  timezone: string;
  /**
   * Supplied by the dashboard's ticking clock rather than read here, so every
   * card on screen agrees on what counts as past and they all dim together on
   * the same minute boundary.
   */
  now: Date;
}

/**
 * One timed event, drawn as a block whose height is its duration. The block is
 * positioned by {@link DayColumn}; everything here only has to survive being
 * short. Container queries reveal the location and feed lines when the block is
 * tall enough to hold them, so a 20-minute event still shows its title.
 *
 * The block is a button: a short one cannot show everything the feed knows, so
 * tapping it opens the detail popup with the rest.
 */
export function EventCard({
  occurrence,
  selectionKey,
  isSelected,
  onSelect,
  continuesBefore,
  continuesAfter,
  timezone,
  now,
}: Props): JSX.Element {
  const isPast = new Date(occurrence.endsAt).getTime() < now.getTime();

  return (
    <button
      type="button"
      className={`event-card rounded-end ${isPast ? 'event-card--past' : ''} ${
        continuesBefore ? 'event-card--from-before' : ''
      } ${continuesAfter ? 'event-card--into-next' : ''} ${
        isSelected ? 'event-card--selected' : ''
      }`}
      style={{ borderLeftColor: occurrence.feedColor }}
      aria-expanded={isSelected}
      onClick={(event) => onSelect(selectionKey, occurrence, event.currentTarget)}
      title={`${timeLabel(occurrence.startsAt, timezone)}–${timeLabel(
        occurrence.endsAt,
        timezone,
      )} ${occurrence.summary}`}
    >
      <div className="event-card__time">
        {continuesBefore ? (
          <>
            <i className="bi bi-arrow-bar-right" aria-hidden="true" />{' '}
            {timeLabel(occurrence.startsAt, timezone)}
          </>
        ) : (
          timeLabel(occurrence.startsAt, timezone)
        )}
        <span className="event-card__time-end">
          {' – '}
          {timeLabel(occurrence.endsAt, timezone)}
        </span>
      </div>

      <div className="event-card__summary">{occurrence.summary}</div>

      {occurrence.location && (
        <div className="event-card__meta event-card__meta--optional text-truncate">
          <i className="bi bi-geo-alt" aria-hidden="true" /> {occurrence.location}
        </div>
      )}

      <div className="event-card__meta event-card__meta--optional event-card__feed">
        <span
          className="feed-dot"
          style={{ backgroundColor: occurrence.feedColor }}
          aria-hidden="true"
        />
        <span className="text-truncate">{occurrence.feedName}</span>
        {occurrence.isRecurring && (
          <i className="bi bi-arrow-repeat" title="Repeating event" aria-hidden="true" />
        )}
      </div>
    </button>
  );
}

/**
 * An all-day event. These have no place on a time grid, so they sit in a band
 * above it that is the same height in every column — keeping the hour lines of
 * neighbouring days aligned. Tapping one opens the same detail popup a timed
 * block does.
 */
export function AllDayChip({
  occurrence,
  selectionKey,
  isSelected,
  onSelect,
  now,
}: {
  occurrence: CalendarOccurrence;
  selectionKey: string;
  isSelected: boolean;
  onSelect: SelectOccurrence;
  now: Date;
}): JSX.Element {
  const isPast = new Date(occurrence.endsAt).getTime() < now.getTime();

  return (
    <button
      type="button"
      className={`allday-chip text-truncate ${isPast ? 'event-card--past' : ''} ${
        isSelected ? 'event-card--selected' : ''
      }`}
      style={{ borderLeftColor: occurrence.feedColor }}
      aria-expanded={isSelected}
      onClick={(event) => onSelect(selectionKey, occurrence, event.currentTarget)}
      title={occurrence.summary}
    >
      {occurrence.summary}
    </button>
  );
}
