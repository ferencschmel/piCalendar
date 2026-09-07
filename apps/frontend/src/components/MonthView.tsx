import { useMemo } from 'react';
import type { AgendaDay, CalendarOccurrence } from '@picalendar/shared';
import type { SelectOccurrence } from './EventCard.js';
import { timeLabel } from '../utils/datetime.js';
import {
  dayOfMonth,
  isInMonth,
  monthGridWeeks,
  weekdayLabels,
  type MonthAnchor,
} from '../utils/calendarGrid.js';

interface Props {
  anchor: MonthAnchor;
  /** The agenda for the whole grid, including the neighbouring months' edges. */
  days: AgendaDay[];
  /** Today in the display timezone, so the highlight survives a stale poll. */
  todayKey: string;
  timezone: string;
  now: Date;
  /** Key of the dot whose detail popup is open, if it is one of this month's. */
  selectedKey: string | null;
  onSelect: SelectOccurrence;
}

/**
 * Dots a cell draws before it starts counting. A household day with more than
 * this on it is already "very busy" at a glance, and the row of dots must not
 * push the date number out of the cell.
 */
const MAX_DOTS = 10;

/** `09:30 · Swim practice`, or `All day · Half term`. */
function dotTitle(occurrence: CalendarOccurrence, timezone: string): string {
  const when = occurrence.allDay ? 'All day' : timeLabel(occurrence.startsAt, timezone);
  return `${when} · ${occurrence.summary}`;
}

function MonthCell({
  dayKey,
  anchor,
  occurrences,
  isToday,
  timezone,
  now,
  selectedKey,
  onSelect,
}: {
  dayKey: string;
  anchor: MonthAnchor;
  occurrences: CalendarOccurrence[];
  isToday: boolean;
  timezone: string;
  now: Date;
  selectedKey: string | null;
  onSelect: SelectOccurrence;
}): JSX.Element {
  const outside = !isInMonth(dayKey, anchor);
  const shown = occurrences.slice(0, MAX_DOTS);
  const hidden = occurrences.length - shown.length;

  return (
    <div
      className={`month-cell ${outside ? 'month-cell--outside' : ''} ${
        isToday ? 'month-cell--today' : ''
      }`}
    >
      <div className="month-cell__date">{dayOfMonth(dayKey)}</div>

      <div className="month-cell__dots">
        {shown.map((occurrence) => {
          const key = `${occurrence.id}-${dayKey}`;
          const isPast = new Date(occurrence.endsAt).getTime() < now.getTime();
          const title = dotTitle(occurrence, timezone);

          return (
            <button
              key={key}
              type="button"
              // A dot is too small to name an event, so it is a target rather
              // than a label: tapping one opens the same detail popup the week
              // view's blocks do, anchored on the dot itself.
              className={`month-dot ${isPast ? 'month-dot--past' : ''} ${
                selectedKey === key ? 'month-dot--selected' : ''
              }`}
              style={{ backgroundColor: occurrence.feedColor }}
              aria-expanded={selectedKey === key}
              aria-label={title}
              title={title}
              onClick={(event) => onSelect(key, occurrence, event.currentTarget)}
            />
          );
        })}

        {hidden > 0 && (
          <span className="month-cell__more" title={`${hidden} more`}>
            +{hidden}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A whole month as six rows of seven days, sized to fill the screen.
 *
 * The week view answers "what is happening today"; this one answers "how busy
 * is the rest of the month", which needs the shape of the month more than it
 * needs any event's name. Every entry becomes a dot in its feed's colour, so a
 * glance from across the room reads which calendar owns a busy stretch.
 */
export function MonthView({
  anchor,
  days,
  todayKey,
  timezone,
  now,
  selectedKey,
  onSelect,
}: Props): JSX.Element {
  const weeks = useMemo(() => monthGridWeeks(anchor), [anchor]);

  // Indexed by date rather than by position: a response for the month we just
  // stepped away from still lines up on the days the two grids share, and the
  // rest simply render empty until the next poll lands.
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  const weekdays = useMemo(() => weekdayLabels('short'), []);

  return (
    <div className="month-view flex-grow-1 px-3 pb-3">
      <div className="month-view__weekdays" aria-hidden="true">
        {weekdays.map((label) => (
          <div key={label} className="month-view__weekday">
            {label}
          </div>
        ))}
      </div>

      <div className="month-view__grid">
        {weeks.flat().map((dayKey) => {
          const day = byDate.get(dayKey);
          return (
            <MonthCell
              key={dayKey}
              dayKey={dayKey}
              anchor={anchor}
              occurrences={day?.occurrences ?? []}
              isToday={dayKey === todayKey}
              timezone={timezone}
              now={now}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
