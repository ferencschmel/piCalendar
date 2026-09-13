import {
  PAN_STEP_MINUTES,
  hourMarks,
  percentOfWindow,
  windowMinutes,
  type TimeWindow,
} from '../utils/timeline.js';

interface Props {
  timeWindow: TimeWindow;
  /** Mirrors the day columns' all-day band so the hour labels stay aligned. */
  showAllDayBand: boolean;
  /** Timed blocks sitting above and below the visible band, across every day. */
  offscreen: { before: number; after: number };
  canPanEarlier: boolean;
  canPanLater: boolean;
  /** Move the shared band; positive minutes go later in the day. */
  onPan: (deltaMinutes: number) => void;
}

/**
 * Hour labels down the left edge, with an arrow at each end of them. It repeats
 * the day columns' card structure — header, all-day band, timeline — with the
 * chrome made invisible rather than removed, which is what keeps each label
 * level with the gridline it names.
 *
 * The arrows are the visible half of the pan: dragging the grid is the gesture
 * anyone would try second, and the count beside an arrow is the only thing on a
 * wall display that admits the band is hiding an event.
 */
export function TimeAxis({
  timeWindow,
  showAllDayBand,
  offscreen,
  canPanEarlier,
  canPanLater,
  onPan,
}: Props): JSX.Element {
  // A tall window on a short screen would stack labels on top of each other;
  // thin them out so the remaining ones stay readable from across the room.
  const hours = windowMinutes(timeWindow) / 60;
  const step = hours <= 12 ? 1 : hours <= 18 ? 2 : 3;

  return (
    <div className="time-axis card">
      <header className="card-header day-column__header invisible" aria-hidden="true">
        <span className="fw-bold">00</span>
      </header>

      {showAllDayBand && <div className="day-column__allday" />}

      <div className="day-column__timeline time-axis__body">
        <PanButton
          direction="earlier"
          hidden={offscreen.before}
          disabled={!canPanEarlier}
          onPan={onPan}
        />

        {hourMarks(timeWindow)
          .filter((minute) => (minute / 60) % step === 0)
          .map((minute) => (
            <span
              key={minute}
              className="time-axis__label"
              style={{ top: `${percentOfWindow(minute, timeWindow)}%` }}
              aria-hidden="true"
            >
              {String(Math.floor(minute / 60) % 24).padStart(2, '0')}:00
            </span>
          ))}

        <PanButton
          direction="later"
          hidden={offscreen.after}
          disabled={!canPanLater}
          onPan={onPan}
        />
      </div>
    </div>
  );
}

/**
 * One end of the axis. It stays in place when there is nothing off screen and
 * nowhere left to pan — a control that came and went as the day filled up would
 * shift the hour labels sideways under it.
 */
function PanButton({
  direction,
  hidden,
  disabled,
  onPan,
}: {
  direction: 'earlier' | 'later';
  /** How many blocks are out of sight this way; 0 draws no badge. */
  hidden: number;
  disabled: boolean;
  onPan: (deltaMinutes: number) => void;
}): JSX.Element {
  const isEarlier = direction === 'earlier';
  const label = hidden > 0 ? `Show ${direction} (${hidden} hidden)` : `Show ${direction}`;

  return (
    <button
      type="button"
      className={`time-axis__pan time-axis__pan--${direction}`}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => onPan(isEarlier ? -PAN_STEP_MINUTES : PAN_STEP_MINUTES)}
    >
      <i className={`bi bi-chevron-${isEarlier ? 'up' : 'down'}`} aria-hidden="true" />
      {hidden > 0 && <span className="time-axis__pan-count">{hidden}</span>}
    </button>
  );
}
