import { useMemo } from 'react';
import { birthdayLabel, type AgendaDensityDay } from '@picalendar/shared';
import { dateKey, dayKeyLabel, longDateYearLabel } from '../utils/datetime.js';
import {
  dayOfMonth,
  isInMonth,
  monthGridWeeks,
  monthName,
  monthsOfYear,
  weekdayLabels,
  type MonthAnchor,
} from '../utils/calendarGrid.js';

interface Props {
  year: number;
  /** One entry per day of the year, from the density endpoint. */
  days: AgendaDensityDay[];
  /** The window ingest has materialised; days outside it are unknown, not free. */
  coverageStart: string;
  coverageEnd: string;
  todayKey: string;
  timezone: string;
  /** Stepping into a month — a year cell is too small to be an end in itself. */
  onPickMonth: (anchor: MonthAnchor) => void;
}

/**
 * Marks a year cell draws. At this size a day is about the area of a
 * fingernail, so the dots answer "which calendars" rather than "how many"; the
 * tooltip and the month view carry the counts.
 */
const MAX_MARKS = 3;

/** Empty state for a day the response has nothing to say about. */
const NO_MARKS: AgendaDensityDay['marks'] = [];

function markTitle(dayKey: string, day: AgendaDensityDay | undefined, known: boolean): string {
  const date = dayKeyLabel(dayKey);
  // Birthdays are derived from the person records, so they are worth naming
  // even on a day whose feed marks have not been materialised yet.
  const parts = day?.birthdays.map(birthdayLabel) ?? [];

  if (!known) parts.push('events not loaded yet');
  else if (!day || day.total === 0) parts.push('nothing scheduled');
  else parts.push(day.marks.map((mark) => `${mark.feedName} (${mark.count})`).join(', '));

  return `${date} — ${parts.join(' · ')}`;
}

function MiniMonth({
  anchor,
  byDate,
  todayKey,
  coverageStartKey,
  coverageEndKey,
  onPick,
}: {
  anchor: MonthAnchor;
  byDate: Map<string, AgendaDensityDay>;
  todayKey: string;
  coverageStartKey: string;
  coverageEndKey: string;
  onPick: () => void;
}): JSX.Element {
  const weeks = useMemo(() => monthGridWeeks(anchor), [anchor]);
  const weekdays = useMemo(() => weekdayLabels('narrow'), []);
  const label = monthName(anchor);

  return (
    <section className="mini-month" aria-label={`${label} ${anchor.year}`}>
      <button type="button" className="mini-month__title" onClick={onPick}>
        {label}
      </button>

      <div className="mini-month__weekdays" aria-hidden="true">
        {weekdays.map((day, index) => (
          // Narrow weekday names repeat (T, T and S, S), so the column index
          // has to carry the key.
          <span key={index}>{day}</span>
        ))}
      </div>

      <div className="mini-month__grid">
        {weeks.flat().map((dayKey) => {
          if (!isInMonth(dayKey, anchor)) {
            return <span key={dayKey} className="mini-day mini-day--blank" aria-hidden="true" />;
          }

          const day = byDate.get(dayKey);
          // ISO keys sort as dates do, so the coverage test is a string compare.
          const known = dayKey >= coverageStartKey && dayKey <= coverageEndKey;
          const marks = day?.marks.slice(0, MAX_MARKS) ?? NO_MARKS;
          // Only the first fits in the corner; a day with two birthdays is
          // rare and the tooltip names them all.
          const celebration = day?.birthdays[0];

          return (
            <button
              key={dayKey}
              type="button"
              className={`mini-day ${dayKey === todayKey ? 'mini-day--today' : ''} ${
                known ? '' : 'mini-day--unknown'
              }`}
              title={markTitle(dayKey, day, known)}
              onClick={onPick}
            >
              {/* Tucked into the corner rather than given a row of its own:
                  the cell is a fingernail and the feed marks below still have
                  to answer how busy the day is. */}
              {celebration && (
                <i
                  className={`bi ${celebration.icon} mini-day__birthday`}
                  style={{ color: celebration.color }}
                  aria-hidden="true"
                />
              )}
              <span className="mini-day__date">{dayOfMonth(dayKey)}</span>
              <span className="mini-day__marks" aria-hidden="true">
                {marks.map((mark) => (
                  <span
                    key={mark.feedId}
                    className="mini-day__mark"
                    style={{ backgroundColor: mark.color }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Twelve months at once — the shape of the year rather than its contents.
 *
 * Nothing here is readable as an event, and that is the point: it answers
 * "when are the busy weeks" and "is that trip in March or April", then hands
 * off to the month view for anything more specific. Tapping any day or month
 * name steps into that month.
 *
 * Ingest only materialises a rolling window of occurrences, so the far end of
 * the year genuinely has no data rather than no events. Those days are drawn
 * faint and the footnote says where the edge is — a confidently blank December
 * would be a lie.
 */
export function YearView({
  year,
  days,
  coverageStart,
  coverageEnd,
  todayKey,
  timezone,
  onPickMonth,
}: Props): JSX.Element {
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const months = useMemo(() => monthsOfYear(year), [year]);

  // The window's edges are instants; the grid's cells are local dates.
  const coverageStartKey = dateKey(coverageStart, timezone);
  const coverageEndKey = dateKey(coverageEnd, timezone);
  const partiallyCovered = `${year}-01-01` < coverageStartKey || `${year}-12-31` > coverageEndKey;

  return (
    <div className="year-view flex-grow-1 px-3 pb-3">
      <div className="year-view__grid">
        {months.map((anchor) => (
          <MiniMonth
            key={anchor.month}
            anchor={anchor}
            byDate={byDate}
            todayKey={todayKey}
            coverageStartKey={coverageStartKey}
            coverageEndKey={coverageEndKey}
            onPick={() => onPickMonth(anchor)}
          />
        ))}
      </div>

      {partiallyCovered && (
        <p className="year-view__coverage text-body-secondary">
          <i className="bi bi-info-circle me-1" aria-hidden="true" />
          Events are loaded for {longDateYearLabel(coverageStart, timezone)} –{' '}
          {longDateYearLabel(coverageEnd, timezone)}. Faint days outside that range have not been
          fetched yet.
        </p>
      )}
    </div>
  );
}
