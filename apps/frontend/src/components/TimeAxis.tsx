import { hourMarks, percentOfWindow, windowMinutes, type TimeWindow } from '../utils/timeline.js';

interface Props {
  timeWindow: TimeWindow;
  /** Mirrors the day columns' all-day band so the hour labels stay aligned. */
  showAllDayBand: boolean;
}

/**
 * Hour labels down the left edge. It repeats the day columns' card structure —
 * header, all-day band, timeline — with the chrome made invisible rather than
 * removed, which is what keeps each label level with the gridline it names.
 */
export function TimeAxis({ timeWindow, showAllDayBand }: Props): JSX.Element {
  // A tall window on a short screen would stack labels on top of each other;
  // thin them out so the remaining ones stay readable from across the room.
  const hours = windowMinutes(timeWindow) / 60;
  const step = hours <= 12 ? 1 : hours <= 18 ? 2 : 3;

  return (
    <div className="time-axis card" aria-hidden="true">
      <header className="card-header day-column__header invisible">
        <span className="fw-bold">00</span>
      </header>

      {showAllDayBand && <div className="day-column__allday" />}

      <div className="day-column__timeline time-axis__body">
        {hourMarks(timeWindow)
          .filter((minute) => (minute / 60) % step === 0)
          .map((minute) => (
            <span
              key={minute}
              className="time-axis__label"
              style={{ top: `${percentOfWindow(minute, timeWindow)}%` }}
            >
              {String(Math.floor(minute / 60) % 24).padStart(2, '0')}:00
            </span>
          ))}
      </div>
    </div>
  );
}
