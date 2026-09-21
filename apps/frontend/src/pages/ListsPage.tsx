import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GROCERY_LIST_ID, listProgressLabel, type ListSummary } from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';

/**
 * The lists the household keeps.
 *
 * The grocery list is always the first card and never has a delete on it: it
 * is derived from the menu rather than typed in, so there is nothing to throw
 * away. Everything below it is somebody's own list.
 */

/**
 * Slower than the dashboard. This page is driven by what someone is doing to
 * it, and every change refreshes immediately anyway — the poll only exists so
 * a list added on the wall appears on a phone already looking at it.
 */
const LISTS_POLL_MS = 30_000;

export function ListsPage(): JSX.Element {
  const poll = usePolling(() => api.listLists(), LISTS_POLL_MS);
  const { refresh } = poll;

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (name.trim() === '' || busy) return;

      setBusy(true);
      setError(null);
      try {
        await api.createList({ name });
        setName('');
        refresh();
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : 'Could not add that list. Try again?',
        );
        // A name that already exists is still a list the household wanted to
        // reach, so the one that is already there comes into view.
        if (caught instanceof ApiError && caught.status === 409) refresh();
      } finally {
        setBusy(false);
      }
    },
    [busy, name, refresh],
  );

  const lists = poll.data ?? [];

  return (
    <div className="list-page">
      <header className="list-page__header">
        <h1 className="h3 mb-0">Lists</h1>
      </header>

      {poll.loading && <p className="text-body-secondary">Loading…</p>}

      {poll.error && !poll.data && (
        <div className="alert alert-warning" role="alert">
          Could not load the lists.
        </div>
      )}

      <div className="list-index">
        {lists.map((summary) => (
          <ListCard key={summary.id} summary={summary} />
        ))}
      </div>

      <form className="list-page__new" onSubmit={create}>
        <label className="form-label" htmlFor="new-list-name">
          Start another list
        </label>
        <div className="input-group input-group-lg">
          <input
            id="new-list-name"
            className="form-control"
            value={name}
            maxLength={60}
            placeholder="Hardware, packing, birthday…"
            onChange={(event) => setName(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || name.trim() === ''}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            Add
          </button>
        </div>
        {error && (
          <p className="text-danger small mb-0 mt-2" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function ListCard({ summary }: { summary: ListSummary }): JSX.Element {
  const isGrocery = summary.id === GROCERY_LIST_ID;

  return (
    <Link
      to={`/lists/${summary.id}`}
      className={`list-card${isGrocery ? ' list-card--grocery' : ''}`}
    >
      <i
        className={`bi bi-${isGrocery ? 'basket3' : 'card-checklist'} list-card__icon`}
        aria-hidden="true"
      />
      <span className="list-card__text">
        <span className="list-card__name">{summary.name}</span>
        <span className="list-card__meta">
          {/* An empty derived list is not a list nobody has filled in — it is a
              week nobody has planned, and there is nothing to buy either way. */}
          {isGrocery && summary.itemCount === 0
            ? 'Nothing to buy'
            : listProgressLabel(
                summary.itemCount,
                summary.checkedCount,
                isGrocery ? 'bought' : 'done',
              )}
          {summary.note && <> · {summary.note}</>}
        </span>
      </span>
      <i className="bi bi-chevron-right list-card__chevron" aria-hidden="true" />
    </Link>
  );
}
