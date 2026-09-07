import { useMemo, type CSSProperties } from 'react';
import type { AgendaResponse, PresenceState } from '@picalendar/shared';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useClock } from '../hooks/useClock.js';
import { DayColumn } from '../components/DayColumn.js';
import { TimeAxis } from '../components/TimeAxis.js';
import { allDayOccurrences, computeTimeWindow } from '../utils/timeline.js';

/** Today plus the next seven days. */
const DAYS = 8;
/**
 * How many all-day events a column shows before the band scrolls. Every column
 * reserves the same band height, so this caps what one busy day can steal from
 * the time grid.
 */
const MAX_ALL_DAY_ROWS = 3;
const AGENDA_POLL_MS = 60_000;
/** Presence changes fast; the agenda it selects does not. */
const PRESENCE_POLL_MS = 15_000;

export function DashboardPage(): JSX.Element {
  const now = useClock();

  const presence = usePolling<PresenceState>(() => api.presence(), PRESENCE_POLL_MS);

  // Once the camera reports who is in the room the agenda narrows to them.
  // Empty presence means "show everything", which is the pre-camera behaviour.
  const presentIds = useMemo(
    () => presence.data?.present.map((p) => p.personId) ?? [],
    [presence.data],
  );
  const presenceKey = presentIds.join(',');

  const agenda = usePolling<AgendaResponse>(
    () => api.agenda({ days: DAYS, personId: presentIds }),
    AGENDA_POLL_MS,
    [presenceKey],
  );

  const timezone = agenda.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const days = useMemo(() => agenda.data?.days ?? [], [agenda.data]);

  // One scale for the whole board: the earliest start and latest end anywhere
  // on screen set the top and bottom of every column, so a day is read by
  // height alone and events never scroll out of view.
  const timeWindow = useMemo(() => computeTimeWindow(days, timezone), [days, timezone]);

  // The all-day band is as tall as the busiest day needs, in every column, so
  // the hour gridlines stay level across the board.
  const allDayRows = useMemo(
    () =>
      Math.min(Math.max(0, ...days.map((day) => allDayOccurrences(day).length)), MAX_ALL_DAY_ROWS),
    [days],
  );

  const staleSeconds = agenda.lastUpdatedAt
    ? Math.round((now.getTime() - agenda.lastUpdatedAt.getTime()) / 1000)
    : null;
  // Two missed polls in a row is the point where the wall is showing something
  // the operator should not trust.
  const isStale = staleSeconds !== null && staleSeconds > (AGENDA_POLL_MS / 1000) * 2;

  return (
    <div className="dashboard d-flex flex-column">
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

        <div className="text-end">
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
              {agenda.lastUpdatedAt?.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              }) ?? '—'}
            </span>
          )}
        </div>
      </header>

      {agenda.loading && !agenda.data && (
        <div className="flex-grow-1 d-flex align-items-center justify-content-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading agenda…</span>
          </div>
        </div>
      )}

      {agenda.error && !agenda.data && (
        <div className="alert alert-danger mx-4" role="alert">
          Could not load the agenda: {agenda.error.message}
        </div>
      )}

      {agenda.data && (
        <div
          className="dashboard__grid flex-grow-1 px-3 pb-3"
          style={{ '--pical-allday-rows': allDayRows } as CSSProperties}
        >
          <TimeAxis timeWindow={timeWindow} showAllDayBand={allDayRows > 0} />
          {agenda.data.days.map((day) => (
            <DayColumn
              key={day.date}
              day={day}
              timezone={timezone}
              now={now}
              timeWindow={timeWindow}
              showAllDayBand={allDayRows > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
