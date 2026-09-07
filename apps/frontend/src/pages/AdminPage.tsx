import { useState } from 'react';
import type { Birthday, Feed, HealthResponse, Person } from '@picalendar/shared';
import { api, ApiError, getAdminToken, setAdminToken } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { FeedForm } from '../components/FeedForm.js';
import { BirthdaysPanel } from '../components/BirthdaysPanel.js';
import { PeoplePanel } from '../components/PeoplePanel.js';

interface AdminData {
  feeds: Feed[];
  people: Person[];
  birthdays: Birthday[];
  health: HealthResponse;
}

/** Slow refresh: this page is driven by explicit actions, not by the clock. */
const ADMIN_POLL_MS = 30_000;

export function AdminPage(): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Feed | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [token, setToken] = useState(getAdminToken);

  // The same hook the dashboard uses: it keeps the last good data on screen
  // while a refresh runs, and `refresh()` re-pulls after every mutation.
  const admin = usePolling<AdminData>(async () => {
    const [feeds, people, birthdays, health] = await Promise.all([
      api.listFeeds(),
      api.listPeople(),
      api.listBirthdays(),
      api.health(),
    ]);
    return { feeds, people, birthdays, health };
  }, ADMIN_POLL_MS);

  const feeds = admin.data?.feeds ?? [];
  const people = admin.data?.people ?? [];
  const birthdays = admin.data?.birthdays ?? [];
  const health = admin.data?.health ?? null;
  const load = admin.refresh;
  const error =
    actionError ??
    (admin.error
      ? admin.error instanceof ApiError
        ? admin.error.message
        : 'Could not reach the backend'
      : null);

  async function runAction(action: () => Promise<unknown>, failureMessage: string): Promise<void> {
    setActionError(null);
    try {
      await action();
      load();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : failureMessage);
    }
  }

  async function handleSync(feed: Feed): Promise<void> {
    setSyncingId(feed.id);
    try {
      await runAction(() => api.syncFeed(feed.id), 'Sync failed');
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDelete(feed: Feed): Promise<void> {
    if (!window.confirm(`Delete “${feed.name}” and all of its events?`)) return;
    await runAction(() => api.deleteFeed(feed.id), 'Delete failed');
  }

  async function handleToggle(feed: Feed): Promise<void> {
    await runAction(() => api.updateFeed(feed.id, { enabled: !feed.enabled }), 'Update failed');
  }

  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="d-flex justify-content-between align-items-center">
          <h1 className="h3 mb-0">Administration</h1>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            Add feed
          </button>
        </div>
      </div>

      {error && (
        <div className="col-12">
          <div className="alert alert-danger mb-0" role="alert">
            {error}
          </div>
        </div>
      )}

      {showForm && (
        <div className="col-12">
          <FeedForm
            people={people}
            editing={editing}
            onSaved={() => {
              setShowForm(false);
              setEditing(null);
              load();
            }}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">Calendar feeds</div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="text-end">
                    Events
                  </th>
                  <th scope="col">Last sync</th>
                  <th scope="col" className="text-end">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {feeds.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-body-secondary fst-italic">
                      No feeds configured. Add an iCloud or SportsEngine calendar to get started.
                    </td>
                  </tr>
                )}
                {feeds.map((feed) => (
                  <tr key={feed.id} className={feed.enabled ? '' : 'opacity-50'}>
                    <td>
                      <span className="d-flex align-items-center gap-2">
                        <span
                          className="feed-dot"
                          style={{ backgroundColor: feed.color }}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="d-block">{feed.name}</span>
                          <span className="small text-body-secondary text-truncate d-inline-block feed-url">
                            {feed.url}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="badge text-bg-secondary">{feed.sourceType}</span>
                    </td>
                    <td className="text-end">{feed.eventCount}</td>
                    <td>
                      {feed.lastStatus === 'error' ? (
                        <span className="text-danger" title={feed.lastError ?? undefined}>
                          <i className="bi bi-x-circle me-1" aria-hidden="true" />
                          Failed
                        </span>
                      ) : feed.lastSyncedAt ? (
                        <span className="text-body-secondary small">
                          {new Date(feed.lastSyncedAt).toLocaleString('en-GB')}
                        </span>
                      ) : (
                        <span className="text-body-secondary small">Never</span>
                      )}
                    </td>
                    <td className="text-end text-nowrap">
                      <div className="btn-group btn-group-sm">
                        <button
                          className="btn btn-outline-secondary"
                          type="button"
                          onClick={() => void handleSync(feed)}
                          disabled={syncingId === feed.id}
                          title="Sync now"
                        >
                          <i
                            className={`bi bi-arrow-clockwise ${syncingId === feed.id ? 'spin' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          className="btn btn-outline-secondary"
                          type="button"
                          onClick={() => void handleToggle(feed)}
                          title={feed.enabled ? 'Disable' : 'Enable'}
                        >
                          <i
                            className={`bi ${feed.enabled ? 'bi-pause' : 'bi-play'}`}
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          className="btn btn-outline-secondary"
                          type="button"
                          onClick={() => {
                            setEditing(feed);
                            setShowForm(true);
                          }}
                          title="Edit"
                        >
                          <i className="bi bi-pencil" aria-hidden="true" />
                        </button>
                        <button
                          className="btn btn-outline-danger"
                          type="button"
                          onClick={() => void handleDelete(feed)}
                          title="Delete"
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="col-lg-4 d-flex flex-column gap-4">
        <PeoplePanel people={people} onChanged={load} />

        <BirthdaysPanel birthdays={birthdays} onChanged={load} />

        <div className="card">
          <div className="card-header">System</div>
          <div className="card-body">
            {health ? (
              <dl className="row mb-0 small">
                <dt className="col-6">Status</dt>
                <dd className="col-6">
                  <span
                    className={`badge ${health.status === 'ok' ? 'text-bg-success' : 'text-bg-warning'}`}
                  >
                    {health.status}
                  </span>
                </dd>
                <dt className="col-6">Version</dt>
                <dd className="col-6">{health.version}</dd>
                <dt className="col-6">Uptime</dt>
                <dd className="col-6">{Math.round(health.uptimeSeconds / 60)} min</dd>
                <dt className="col-6">Feeds failing</dt>
                <dd className="col-6">{health.feeds.failing}</dd>
              </dl>
            ) : (
              <p className="text-body-secondary mb-0">Backend unreachable.</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">Admin token</div>
          <div className="card-body">
            <p className="small text-body-secondary">
              Only needed if the backend was started with <code>ADMIN_TOKEN</code> set. Stored in
              this browser only.
            </p>
            <div className="input-group input-group-sm">
              <input
                type="password"
                className="form-control"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Bearer token"
                aria-label="Admin token"
              />
              <button
                className="btn btn-outline-secondary"
                type="button"
                onClick={() => {
                  setAdminToken(token);
                  load();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
