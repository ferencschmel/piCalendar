/**
 * The dashboard's header controls: which calendar shape is on screen, and which
 * period that shape is showing.
 *
 * They sit between the clock and the admin gear because that is the one part of
 * the header a passer-by is meant to touch — the clock is information and the
 * gear is deliberately hard to find.
 */

/** The three shapes the calendar can take. */
export type DashboardView = 'week' | 'month' | 'year';

const VIEWS: Array<{ value: DashboardView; label: string; icon: string }> = [
  { value: 'week', label: 'Week', icon: 'calendar-week' },
  { value: 'month', label: 'Month', icon: 'calendar-month' },
  { value: 'year', label: 'Year', icon: 'calendar4-range' },
];

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: DashboardView;
  onChange: (view: DashboardView) => void;
}): JSX.Element {
  return (
    <div className="btn-group view-switcher" role="group" aria-label="Calendar view">
      {VIEWS.map((option) => {
        const isActive = option.value === view;
        return (
          <button
            key={option.value}
            type="button"
            className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'}`}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
          >
            <i className={`bi bi-${option.icon}`} aria-hidden="true" />
            <span className="view-switcher__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Step back and forward through months or years, with a way home.
 *
 * "Today" only appears once you have wandered off it: an unattended wall
 * display is always on the current period, so the button would be dead chrome
 * the vast majority of the time it is up.
 */
export function PeriodNav({
  label,
  unit,
  isCurrent,
  onStep,
  onToday,
}: {
  /** What is on screen — `September 2026` or `2026`. */
  label: string;
  /** Named in the button labels, so a screen reader hears "Previous month". */
  unit: string;
  isCurrent: boolean;
  onStep: (delta: number) => void;
  onToday: () => void;
}): JSX.Element {
  return (
    <div className="period-nav">
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary period-nav__step"
        aria-label={`Previous ${unit}`}
        onClick={() => onStep(-1)}
      >
        <i className="bi bi-chevron-left" aria-hidden="true" />
      </button>

      <span className="period-nav__label" aria-live="polite">
        {label}
      </span>

      <button
        type="button"
        className="btn btn-sm btn-outline-secondary period-nav__step"
        aria-label={`Next ${unit}`}
        onClick={() => onStep(1)}
      >
        <i className="bi bi-chevron-right" aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`btn btn-sm btn-outline-secondary period-nav__today ${
          isCurrent ? 'invisible' : ''
        }`}
        // Hidden rather than removed: the header must not reflow — and jog the
        // whole grid sideways — the moment someone steps off this month.
        tabIndex={isCurrent ? -1 : undefined}
        aria-hidden={isCurrent}
        onClick={onToday}
      >
        Today
      </button>
    </div>
  );
}
