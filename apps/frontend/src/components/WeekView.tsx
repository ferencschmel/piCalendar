import { useMemo, type CSSProperties } from 'react';
import type { AgendaDay } from '@picalendar/shared';
import { DayColumn } from './DayColumn.js';
import type { SelectOccurrence } from './EventCard.js';
import { TimeAxis } from './TimeAxis.js';
import { allDayOccurrences, computeTimeWindow } from '../utils/timeline.js';

/**
 * How many rows the band above the time grid shows before it scrolls. Every
 * column reserves the same band height, so this caps what one busy day can
 * steal from the time grid.
 */
const MAX_ALL_DAY_ROWS = 4;

interface Props {
  days: AgendaDay[];
  timezone: string;
  now: Date;
  /** Key of the block whose detail popup is open. */
  selectedKey: string | null;
  onSelect: SelectOccurrence;
}

/**
 * Today plus the following days as side-by-side time grids — the dashboard's
 * default and the only view that shows an event's name and hour without being
 * asked.
 */
export function WeekView({ days, timezone, now, selectedKey, onSelect }: Props): JSX.Element {
  // One scale for the whole board: the earliest start and latest end anywhere
  // on screen set the top and bottom of every column, so a day is read by
  // height alone and events never scroll out of view.
  const timeWindow = useMemo(() => computeTimeWindow(days, timezone), [days, timezone]);

  // The band is as tall as the busiest day needs, in every column, so the hour
  // gridlines stay level across the board. Birthdays share it with the all-day
  // events and are counted here for the same reason.
  const allDayRows = useMemo(
    () =>
      Math.min(
        Math.max(0, ...days.map((day) => allDayOccurrences(day).length + day.birthdays.length)),
        MAX_ALL_DAY_ROWS,
      ),
    [days],
  );

  return (
    <div
      className="dashboard__grid flex-grow-1 px-3 pb-3"
      style={{ '--pical-allday-rows': allDayRows } as CSSProperties}
    >
      <TimeAxis timeWindow={timeWindow} showAllDayBand={allDayRows > 0} />
      {days.map((day) => (
        <DayColumn
          key={day.date}
          day={day}
          timezone={timezone}
          now={now}
          timeWindow={timeWindow}
          showAllDayBand={allDayRows > 0}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
