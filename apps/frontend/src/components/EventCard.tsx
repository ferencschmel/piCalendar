import type { CalendarOccurrence } from '@picalendar/shared';

interface Props {
  occurrence: CalendarOccurrence;
  /** The day column this card is rendered in, for multi-day continuation hints. */
  dayKey: string;
  timezone: string;
  /**
   * Supplied by the dashboard's ticking clock rather than read here, so every
   * card on screen agrees on what counts as past and they all dim together on
   * the same minute boundary.
   */
  now: Date;
}

function timeLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
}

function dayKeyOf(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
}

export function EventCard({ occurrence, dayKey, timezone, now }: Props): JSX.Element {
  const startsOnThisDay = dayKeyOf(occurrence.startsAt, timezone) === dayKey;
  // An event ending exactly at midnight belongs to the previous day, so probe
  // one second earlier rather than the raw end timestamp.
  const endsOnThisDay =
    dayKeyOf(new Date(new Date(occurrence.endsAt).getTime() - 1000).toISOString(), timezone) ===
    dayKey;
  const isPast = new Date(occurrence.endsAt).getTime() < now.getTime();

  return (
    <article
      className={`event-card border-start ps-2 py-2 mb-2 rounded-end ${isPast ? 'event-card--past' : ''}`}
      style={{ borderLeftColor: occurrence.feedColor, borderLeftWidth: '4px' }}
    >
      <div className="d-flex justify-content-between align-items-baseline gap-2">
        <span className="event-card__time fw-semibold">
          {occurrence.allDay ? (
            'All day'
          ) : startsOnThisDay ? (
            timeLabel(occurrence.startsAt, timezone)
          ) : (
            <span title={`Started ${timeLabel(occurrence.startsAt, timezone)}`}>
              <i className="bi bi-arrow-bar-right" aria-hidden="true" /> continues
            </span>
          )}
        </span>
        {!occurrence.allDay && startsOnThisDay && endsOnThisDay && (
          <span className="event-card__time text-body-secondary small">
            {timeLabel(occurrence.endsAt, timezone)}
          </span>
        )}
      </div>

      <div className="event-card__summary">{occurrence.summary}</div>

      {occurrence.location && (
        <div className="event-card__meta text-body-secondary text-truncate">
          <i className="bi bi-geo-alt" aria-hidden="true" /> {occurrence.location}
        </div>
      )}

      <div className="event-card__meta text-body-secondary d-flex align-items-center gap-1">
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
    </article>
  );
}
