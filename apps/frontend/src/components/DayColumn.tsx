import type { AgendaDay } from '@picalendar/shared';
import { BirthdayChip } from './BirthdayChip.js';
import { AllDayChip, EventCard, type SelectOccurrence } from './EventCard.js';
import {
  allDayOccurrences,
  hourMarks,
  layoutDay,
  minutesFromDayStart,
  percentOfWindow,
  type TimeWindow,
} from '../utils/timeline.js';

interface Props {
  day: AgendaDay;
  timezone: string;
  now: Date;
  /** The scale shared by every column on screen. */
  timeWindow: TimeWindow;
  /** Whether any day on screen has all-day events, so the band is reserved. */
  showAllDayBand: boolean;
  /** Key of the block whose detail popup is open, if it is one of this day's. */
  selectedKey: string | null;
  onSelect: SelectOccurrence;
}

/** Gutter between two events that share a time slot. */
const LANE_GAP = '2px';

export function DayColumn({
  day,
  timezone,
  now,
  timeWindow,
  showAllDayBand,
  selectedKey,
  onSelect,
}: Props): JSX.Element {
  const date = new Date(`${day.date}T12:00:00Z`);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const dayOfMonth = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  const allDay = allDayOccurrences(day);
  const positioned = layoutDay(day, timezone, timeWindow);

  // The current-time line only makes sense on today, and only while the clock
  // is inside the window the events themselves defined.
  const nowMinute = day.isToday ? minutesFromDayStart(now.toISOString(), timezone, day.date) : null;
  const showNowLine =
    nowMinute !== null && nowMinute >= timeWindow.startMinute && nowMinute <= timeWindow.endMinute;

  return (
    <section
      className={`day-column card ${day.isToday ? 'day-column--today' : ''}`}
      aria-label={`${weekday} ${dayOfMonth}`}
    >
      <header className="card-header day-column__header d-flex justify-content-between align-items-baseline">
        <span className="fw-bold">{day.isToday ? 'Today' : weekday}</span>
        <span className="text-body-secondary small">{dayOfMonth}</span>
      </header>

      {showAllDayBand && (
        <div className="day-column__allday">
          {/* First in the band, so a birthday is the one thing in the column
              that cannot be scrolled out of sight on a busy day. */}
          {day.birthdays.map((celebration) => (
            <BirthdayChip key={celebration.birthdayId} celebration={celebration} />
          ))}

          {allDay.map((occurrence) => {
            const key = `${occurrence.id}-${day.date}`;
            return (
              <AllDayChip
                key={key}
                selectionKey={key}
                isSelected={selectedKey === key}
                onSelect={onSelect}
                occurrence={occurrence}
                now={now}
              />
            );
          })}
        </div>
      )}

      <div className="day-column__timeline">
        {hourMarks(timeWindow).map((minute) => (
          <div
            key={minute}
            className="timeline__hour-line"
            style={{ top: `${percentOfWindow(minute, timeWindow)}%` }}
            aria-hidden="true"
          />
        ))}

        {positioned.map((item) => {
          const top = percentOfWindow(item.startMinute, timeWindow);
          const height = percentOfWindow(item.endMinute, timeWindow) - top;
          const key = `${item.occurrence.id}-${day.date}`;

          return (
            <div
              key={key}
              className="timeline__slot"
              style={{
                top: `${top}%`,
                height: `${height}%`,
                left: `calc(${(item.lane / item.laneCount) * 100}% + ${item.lane === 0 ? '0px' : LANE_GAP})`,
                width: `calc(${100 / item.laneCount}% - ${item.lane === 0 ? '0px' : LANE_GAP})`,
              }}
            >
              <EventCard
                occurrence={item.occurrence}
                selectionKey={key}
                isSelected={selectedKey === key}
                onSelect={onSelect}
                continuesBefore={item.continuesBefore}
                continuesAfter={item.continuesAfter}
                timezone={timezone}
                now={now}
              />
            </div>
          );
        })}

        {showNowLine && (
          <div
            className="timeline__now"
            style={{ top: `${percentOfWindow(nowMinute, timeWindow)}%` }}
            aria-hidden="true"
          />
        )}

        {day.occurrences.length === 0 && (
          <p className="timeline__empty text-body-secondary small fst-italic">Nothing scheduled</p>
        )}
      </div>
    </section>
  );
}
