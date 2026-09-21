import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addMonthsToKey,
  formatMoney,
  monthKeyOf,
  type TaskEarningsPerson,
} from '@picalendar/shared';
import { api } from '../api/client.js';
import { useClock } from '../hooks/useClock.js';
import { usePolling } from '../hooks/usePolling.js';
import { dateKey, monthKeyLabel } from '../utils/datetime.js';

/**
 * What everybody earned, a month at a time.
 *
 * A month rather than a running total because a month is the unit pocket money
 * is actually settled in — and because the question this page answers is asked
 * on one day of it, by somebody holding a wallet.
 *
 * Every figure is read off the ticks themselves, each of which carries the
 * price it was made at. So a month that has been settled stays settled: putting
 * the bins up from 50c to $1 today does not quietly add back-pay to March, and
 * handing the chore to a sibling does not hand them the month somebody else
 * spent doing it. The page therefore never shows a task's current price beside
 * a past total, which would be two numbers that look as though they should
 * multiply out and do not.
 */

/** Earnings only move when somebody ticks something, so the board's cadence. */
const EARNINGS_POLL_MS = 60_000;

/**
 * How long a month somebody stepped back to waits before returning to this one.
 *
 * The same override the board's day is, and for the same reason: this page is
 * one tap from a wall nobody is looking after, and a display left on August
 * is a display that will still be on August in October. `null` — rather than
 * today's month written down — is what rolls it into the new month by itself.
 */
const IDLE_RESET_MS = 120_000;

export function TaskEarningsPage(): JSX.Element {
  const now = useClock();
  /** Null means "whatever month it is", which is what an unattended wall wants. */
  const [monthOverride, setMonthOverride] = useState<string | null>(null);

  const poll = usePolling(
    () => api.taskEarnings(monthOverride ? { month: monthOverride } : {}),
    EARNINGS_POLL_MS,
    [monthOverride],
  );
  const data = poll.data;

  // Re-armed by every step, because each one changes `monthOverride` and so
  // re-runs this effect; it cancels itself once the page is home again.
  useEffect(() => {
    if (monthOverride === null) return;
    const timer = window.setTimeout(() => setMonthOverride(null), IDLE_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [monthOverride]);

  /** This month as the *display* reckons it, not as the browser does. */
  const thisMonth = data ? monthKeyOf(dateKey(now.toISOString(), data.timezone)) : '';
  const month = data?.month ?? thisMonth;
  const step = useCallback(
    (months: number) => setMonthOverride((current) => addMonthsToKey(current ?? month, months)),
    [month],
  );

  const people = data?.people ?? [];
  const earners = people.filter((person) => person.totalCents > 0 || person.completions > 0);

  return (
    <div className="list-page">
      <div className="list-page__sticky">
        <header className="list-page__header">
          <Link to="/tasks" className="list-page__back">
            <i className="bi bi-chevron-left" aria-hidden="true" />
            <span>Board</span>
          </Link>
          <h1 className="h4 mb-0">Earnings</h1>
        </header>

        <div className="earnings__month">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-label="Previous month"
            onClick={() => step(-1)}
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <span className="earnings__month-label">{month ? monthKeyLabel(month) : ''}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-label="Next month"
            onClick={() => step(1)}
          >
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
          {/* Only once somebody has wandered off this month, for the same reason
              the board's "Today" is: otherwise it is dead chrome. */}
          {monthOverride !== null && monthOverride !== thisMonth && (
            <button
              type="button"
              className="btn btn-sm btn-primary ms-1"
              onClick={() => setMonthOverride(null)}
            >
              This month
            </button>
          )}
        </div>
      </div>

      {poll.loading && !data && <p className="text-body-secondary">Loading…</p>}

      {poll.error && !data && (
        <div className="alert alert-warning" role="alert">
          Could not load the earnings.
        </div>
      )}

      {data && (
        <p className="earnings__total">
          <span className="earnings__total-figure">{formatMoney(data.totalCents)}</span>
          <span className="earnings__total-words">
            {data.completions === 0
              ? 'nothing ticked off yet'
              : `across ${data.completions} ${data.completions === 1 ? 'chore' : 'chores'}`}
          </span>
        </p>
      )}

      {data && people.length === 0 && (
        <div className="list-page__empty">
          <i className="bi bi-piggy-bank list-page__empty-icon" aria-hidden="true" />
          <p className="mb-1">Nobody has done anything this month.</p>
          <Link to="/tasks">Back to the board</Link>
        </div>
      )}

      {people.length > 0 && (
        <ul className="earnings__people">
          {people.map((person) => (
            <PersonCard key={person.personId ?? 'anyone'} person={person} />
          ))}
        </ul>
      )}

      {/* Said out loud rather than left to be inferred from a page of zeroes:
          a household that has not priced anything would otherwise read this as
          a page that is broken rather than one that is empty. */}
      {data && earners.length > 0 && data.totalCents === 0 && (
        <p className="earnings__unpriced">
          <i className="bi bi-info-circle me-1" aria-hidden="true" />
          No chore has a price on it yet. Give one a value in its{' '}
          <Link to="/tasks/all">settings</Link> and it will start counting here.
        </p>
      )}
    </div>
  );
}

/**
 * One person's month, and what made it up.
 *
 * The breakdown is not decoration. A total on its own is an assertion, where
 * "the bins nine times, the dishwasher nineteen" is an answer to the question
 * that always follows it — and the count is given rather than a rate, because
 * the days behind it were not necessarily all paid the same.
 */
function PersonCard({ person }: { person: TaskEarningsPerson }): JSX.Element {
  return (
    <li className="earnings__person">
      <div className="earnings__person-head">
        <span
          className="earnings__swatch"
          style={{ backgroundColor: person.color }}
          aria-hidden="true"
        />
        <span className="earnings__name">{person.displayName}</span>
        <span className="earnings__amount">{formatMoney(person.totalCents)}</span>
      </div>

      {person.tasks.length === 0 ? (
        <p className="earnings__nothing">Nothing ticked off this month.</p>
      ) : (
        <ul className="earnings__lines">
          {person.tasks.map((line) => (
            <li key={line.taskId} className="earnings__line">
              <i
                className={`bi ${line.icon} earnings__line-icon`}
                style={{ color: line.color }}
                aria-hidden="true"
              />
              <span className="earnings__line-title">{line.title}</span>
              <span className="earnings__line-count">
                {line.completions} {line.completions === 1 ? 'time' : 'times'}
              </span>
              <span className="earnings__line-amount">{formatMoney(line.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
