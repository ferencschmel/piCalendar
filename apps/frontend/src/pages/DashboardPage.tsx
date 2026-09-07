import { useCallback, useMemo, useState } from 'react';
import type {
  AgendaDensityResponse,
  AgendaResponse,
  CalendarOccurrence,
  PresenceState,
} from '@picalendar/shared';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useClock } from '../hooks/useClock.js';
import { EventDetail } from '../components/EventDetail.js';
import type { SelectOccurrence } from '../components/EventCard.js';
import { MonthView } from '../components/MonthView.js';
import { PeriodNav, ViewSwitcher, type DashboardView } from '../components/ViewControls.js';
import { WeekView } from '../components/WeekView.js';
import { YearView } from '../components/YearView.js';
import { dateKey } from '../utils/datetime.js';
import {
  MONTH_GRID_DAYS,
  daysInYear,
  monthGridStart,
  monthLabel,
  monthOf,
  sameMonth,
  shiftMonth,
  yearStartKey,
  type MonthAnchor,
} from '../utils/calendarGrid.js';

/** Today plus the next seven days. */
const DAYS = 8;
const AGENDA_POLL_MS = 60_000;
/** Presence changes fast; the agenda it selects does not. */
const PRESENCE_POLL_MS = 15_000;

/** The event whose details are on screen, and the block to pin them beside. */
interface Selection {
  key: string;
  occurrence: CalendarOccurrence;
  anchor: HTMLElement;
}

export function DashboardPage(): JSX.Element {
  const now = useClock();

  const [view, setView] = useState<DashboardView>('week');

  /**
   * `null` means "whatever period today falls in", which is what an unattended
   * wall display should show — it rolls over to the new month on its own rather
   * than sticking wherever it was left. Stepping pins an explicit period;
   * "Today" hands it back.
   */
  const [monthOverride, setMonthOverride] = useState<MonthAnchor | null>(null);
  const [yearOverride, setYearOverride] = useState<number | null>(null);

  const [selection, setSelection] = useState<Selection | null>(null);
  const select = useCallback<SelectOccurrence>(
    (key, occurrence, anchor) => setSelection({ key, occurrence, anchor }),
    [],
  );
  const clearSelection = useCallback(() => setSelection(null), []);

  const presence = usePolling<PresenceState>(() => api.presence(), PRESENCE_POLL_MS);

  // Once the camera reports who is in the room the agenda narrows to them.
  // Empty presence means "show everything", which is the pre-camera behaviour.
  const presentIds = useMemo(
    () => presence.data?.present.map((p) => p.personId) ?? [],
    [presence.data],
  );
  const presenceKey = presentIds.join(',');

  // The week and month views differ only in the range they ask for, so they
  // share one poll; the year view asks a different endpoint entirely and gets
  // its own. Exactly one of the two is ever live.
  const isYear = view === 'year';

  /**
   * The zone every label is rendered in. Held in state, not read off the latest
   * response, because the month grid has to know what "this month" is before
   * the poll that would tell it has even been configured. The browser's zone
   * seeds it and the server's replaces it on the first response.
   */
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const todayKey = dateKey(now.toISOString(), timezone);

  const monthAnchor = monthOverride ?? monthOf(todayKey);
  const year = yearOverride ?? Number(todayKey.slice(0, 4));

  const agendaStart = view === 'month' ? monthGridStart(monthAnchor) : undefined;
  const agendaDays = view === 'month' ? MONTH_GRID_DAYS : DAYS;

  const agenda = usePolling<AgendaResponse>(
    () => api.agenda({ start: agendaStart, days: agendaDays, personId: presentIds }),
    AGENDA_POLL_MS,
    [presenceKey, agendaStart ?? '', agendaDays],
    { enabled: !isYear },
  );

  const density = usePolling<AgendaDensityResponse>(
    () =>
      api.agendaDensity({
        start: yearStartKey(year),
        days: daysInYear(year),
        personId: presentIds,
      }),
    AGENDA_POLL_MS,
    [presenceKey, year],
    { enabled: isYear },
  );

  const source = isYear ? density : agenda;

  // Adjusted during render rather than in an effect: React discards this pass
  // and re-runs it with the server's zone before anything is committed, so the
  // month grid above is recomputed rather than painted in the wrong zone first.
  const reportedTimezone = agenda.data?.timezone ?? density.data?.timezone;
  if (reportedTimezone && reportedTimezone !== timezone) setTimezone(reportedTimezone);

  /**
   * The agenda for the range the current view actually asked for.
   *
   * `usePolling` keeps the previous response on screen while a new one is in
   * flight, which is right for a refresh and wrong for a view switch — week and
   * month want different day counts, and rendering one through the other's
   * layout would be nonsense. The requested length identifies the response.
   */
  const agendaData = agenda.data?.days.length === agendaDays ? agenda.data : null;

  const staleSeconds = source.lastUpdatedAt
    ? Math.round((now.getTime() - source.lastUpdatedAt.getTime()) / 1000)
    : null;
  // Two missed polls in a row is the point where the wall is showing something
  // the operator should not trust.
  const isStale = staleSeconds !== null && staleSeconds > (AGENDA_POLL_MS / 1000) * 2;

  // Anything that replaces the grid detaches the element the popup points at.
  const changeView = useCallback((next: DashboardView) => {
    setSelection(null);
    setView(next);
  }, []);

  const stepPeriod = useCallback(
    (delta: number) => {
      setSelection(null);
      if (isYear) {
        setYearOverride((current) => (current ?? Number(todayKey.slice(0, 4))) + delta);
      } else {
        setMonthOverride((current) => shiftMonth(current ?? monthOf(todayKey), delta));
      }
    },
    [isYear, todayKey],
  );

  const goToToday = useCallback(() => {
    setSelection(null);
    setMonthOverride(null);
    setYearOverride(null);
  }, []);

  const openMonth = useCallback((anchor: MonthAnchor) => {
    setSelection(null);
    setMonthOverride(anchor);
    setView('month');
  }, []);

  const today = monthOf(todayKey);
  const isCurrentPeriod = isYear ? year === today.year : sameMonth(monthAnchor, today);

  return (
    <div className={`dashboard dashboard--${view} d-flex flex-column`}>
      <header className="dashboard__header d-flex justify-content-between align-items-center px-4 py-3">
        <div>
          <div className="dashboard__clock">
            {now.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: timezone,
            })}
          </div>
          <div className="dashboard__date text-body-secondary">
            {now.toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: timezone,
            })}
          </div>
        </div>

        <div className="dashboard__controls">
          {view !== 'week' && (
            <PeriodNav
              label={isYear ? String(year) : monthLabel(monthAnchor)}
              unit={isYear ? 'year' : 'month'}
              isCurrent={isCurrentPeriod}
              onStep={stepPeriod}
              onToday={goToToday}
            />
          )}
          <ViewSwitcher view={view} onChange={changeView} />
        </div>

        <div className="dashboard__status text-end">
          {presence.data && presence.data.present.length > 0 && (
            <div className="mb-2">
              <span className="text-body-secondary small me-2">In the room:</span>
              {presence.data.present.map((person) => (
                <span
                  key={person.personId}
                  className="badge rounded-pill me-1"
                  style={{ backgroundColor: person.color }}
                >
                  {person.displayName}
                </span>
              ))}
            </div>
          )}

          {isStale ? (
            <span className="badge text-bg-warning">
              <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
              Last updated {staleSeconds}s ago
            </span>
          ) : (
            <span className="text-body-secondary small">
              <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
              Updated{' '}
              {source.lastUpdatedAt?.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              }) ?? '—'}
            </span>
          )}
        </div>
      </header>

      {source.error && !source.data && (
        <div className="alert alert-danger mx-4" role="alert">
          Could not load the agenda: {source.error.message}
        </div>
      )}

      {view === 'week' &&
        (agendaData ? (
          <WeekView
            days={agendaData.days}
            timezone={timezone}
            now={now}
            selectedKey={selection?.key ?? null}
            onSelect={select}
          />
        ) : (
          <Loading show={!agenda.error} />
        ))}

      {view === 'month' &&
        (agendaData ? (
          <MonthView
            anchor={monthAnchor}
            days={agendaData.days}
            todayKey={todayKey}
            timezone={timezone}
            now={now}
            selectedKey={selection?.key ?? null}
            onSelect={select}
          />
        ) : (
          <Loading show={!agenda.error} />
        ))}

      {view === 'year' &&
        (density.data ? (
          <YearView
            year={year}
            days={density.data.days}
            coverageStart={density.data.coverageStart}
            coverageEnd={density.data.coverageEnd}
            todayKey={todayKey}
            timezone={timezone}
            onPickMonth={openMonth}
          />
        ) : (
          <Loading show={!density.error} />
        ))}

      {selection && (
        <EventDetail
          // Remounted per selection, so the popup's placement and its
          // auto-close countdown both start fresh for each event.
          key={selection.key}
          occurrence={selection.occurrence}
          anchor={selection.anchor}
          timezone={timezone}
          onClose={clearSelection}
        />
      )}
    </div>
  );
}

/** Holds the grid's space while a view waits for the range it asked for. */
function Loading({ show }: { show: boolean }): JSX.Element {
  return (
    <div className="flex-grow-1 d-flex align-items-center justify-content-center">
      {show && (
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading agenda…</span>
        </div>
      )}
    </div>
  );
}
