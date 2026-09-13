import { useMemo, type CSSProperties } from 'react';
import type { AgendaDay } from '@picalendar/shared';
import { DayColumn } from './DayColumn.js';
import type { SelectOccurrence } from './EventCard.js';
import { TimeAxis } from './TimeAxis.js';
import { usePanGesture, useTimeWindow } from '../hooks/useTimeWindow.js';
import { allDayOccurrences, offscreenCounts } from '../utils/timeline.js';

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
 * default shape, whether it is showing three days or eight, and the only view
 * that shows an event's name and hour without being asked.
 */
export function WeekView({ days, timezone, now, selectedKey, onSelect }: Props): JSX.Element {
  // One scale for the whole board — a fixed twelve hours, pannable — so a day
  // is read by height alone and 09:00 is at the same height in every column.
  const { timeWindow, pan, canPanEarlier, canPanLater } = useTimeWindow();
  const panHandlers = usePanGesture(pan, timeWindow);

  // What the band is cutting off, so the axis can say so rather than leaving a
  // display nobody is watching quietly claiming the evening is empty.
  const offscreen = useMemo(
    () => offscreenCounts(days, timezone, timeWindow),
    [days, timezone, timeWindow],
  );

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
      <TimeAxis
        timeWindow={timeWindow}
        showAllDayBand={allDayRows > 0}
        offscreen={offscreen}
        canPanEarlier={canPanEarlier}
        canPanLater={canPanLater}
        onPan={pan}
      />
      {days.map((day) => (
        <DayColumn
          key={day.date}
          day={day}
          timezone={timezone}
          now={now}
          timeWindow={timeWindow}
          showAllDayBand={allDayRows > 0}
          panHandlers={panHandlers}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
