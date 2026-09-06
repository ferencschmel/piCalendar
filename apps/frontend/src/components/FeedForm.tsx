import { useState, type FormEvent } from 'react';
import { feedSourceTypes, type Feed, type FeedInput, type Person } from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';

interface Props {
  people: Person[];
  editing: Feed | null;
  onSaved: () => void;
  onCancel: () => void;
}

const SOURCE_LABELS: Record<(typeof feedSourceTypes)[number], string> = {
  sportsengine: 'SportsEngine',
  icloud: 'Apple iCloud (shared)',
  ics: 'Generic iCalendar',
};

function emptyDraft(): FeedInput {
  return {
    name: '',
    sourceType: 'icloud',
    url: '',
    enabled: true,
    color: '#0d6efd',
    refreshIntervalSeconds: 900,
    personIds: [],
  };
}

export function FeedForm({ people, editing, onSaved, onCancel }: Props): JSX.Element {
  const [draft, setDraft] = useState<FeedInput>(() =>
    editing
      ? {
          name: editing.name,
          sourceType: editing.sourceType,
          url: editing.url,
          enabled: editing.enabled,
          color: editing.color,
          refreshIntervalSeconds: editing.refreshIntervalSeconds,
          personIds: editing.personIds,
        }
      : emptyDraft(),
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const update = <K extends keyof FeedInput>(key: K, value: FeedInput[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  function reportError(caught: unknown): void {
    if (caught instanceof ApiError) {
      setError(caught.message);
      setFieldErrors(caught.details ?? {});
    } else {
      setError(caught instanceof Error ? caught.message : 'Unexpected error');
    }
  }

  /** Validates the URL against the live server before it is ever persisted. */
  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await api.testFeed(draft.url, draft.sourceType);
      setTestResult(
        `Reachable — ${result.eventCount} events, ${result.occurrenceCount} occurrences in the sync window.`,
      );
    } catch (caught) {
      reportError(caught);
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (editing) await api.updateFeed(editing.id, draft);
      else await api.createFeed(draft);
      onSaved();
    } catch (caught) {
      reportError(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={(e) => void handleSubmit(e)}>
      <div className="card-header">
        {editing ? `Edit “${editing.name}”` : 'Add a calendar feed'}
      </div>
      <div className="card-body">
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        {testResult && (
          <div className="alert alert-success" role="status">
            {testResult}
          </div>
        )}

        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="feed-name">
              Display name
            </label>
            <input
              id="feed-name"
              className={`form-control ${fieldErrors.name ? 'is-invalid' : ''}`}
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="U12 Football"
              required
            />
            <div className="invalid-feedback">{fieldErrors.name?.join(' ')}</div>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="feed-source">
              Source
            </label>
            <select
              id="feed-source"
              className="form-select"
              value={draft.sourceType}
              onChange={(e) => update('sourceType', e.target.value as FeedInput['sourceType'])}
            >
              {feedSourceTypes.map((type) => (
                <option key={type} value={type}>
                  {SOURCE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="feed-color">
              Colour
            </label>
            <input
              id="feed-color"
              type="color"
              className="form-control form-control-color w-100"
              value={draft.color}
              onChange={(e) => update('color', e.target.value)}
            />
          </div>

          <div className="col-12">
            <label className="form-label" htmlFor="feed-url">
              Feed URL
            </label>
            <div className="input-group">
              <input
                id="feed-url"
                className={`form-control ${fieldErrors.url ? 'is-invalid' : ''}`}
                value={draft.url}
                onChange={(e) => update('url', e.target.value)}
                placeholder="webcal://p01-calendars.icloud.com/published/2/..."
                required
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => void handleTest()}
                disabled={testing || draft.url.length === 0}
              >
                {testing ? 'Testing…' : 'Test'}
              </button>
              <div className="invalid-feedback">{fieldErrors.url?.join(' ')}</div>
            </div>
            <div className="form-text">
              iCloud: Calendar app → share a calendar → <em>Public Calendar</em> → copy link.
              SportsEngine: team page → Schedule → <em>Subscribe to calendar</em>. Both give a{' '}
              <code>webcal://</code> URL, which is accepted as-is.
            </div>
          </div>

          <div className="col-md-4">
            <label className="form-label" htmlFor="feed-interval">
              Refresh every
            </label>
            <select
              id="feed-interval"
              className="form-select"
              value={draft.refreshIntervalSeconds}
              onChange={(e) => update('refreshIntervalSeconds', Number(e.target.value))}
            >
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
              <option value={1800}>30 minutes</option>
              <option value={3600}>1 hour</option>
              <option value={21600}>6 hours</option>
            </select>
          </div>

          <div className="col-md-8">
            <label className="form-label" htmlFor="feed-people">
              Belongs to
            </label>
            <select
              id="feed-people"
              className="form-select"
              multiple
              size={Math.min(Math.max(people.length, 2), 5)}
              value={draft.personIds}
              onChange={(e) =>
                update(
                  'personIds',
                  Array.from(e.target.selectedOptions, (option) => option.value),
                )
              }
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
            <div className="form-text">
              Used once the camera is fitted: only the calendars of people detected in the room are
              shown. Leave empty for a calendar that should always be visible.
            </div>
          </div>

          <div className="col-12">
            <div className="form-check form-switch">
              <input
                id="feed-enabled"
                className="form-check-input"
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => update('enabled', e.target.checked)}
              />
              <label className="form-check-label" htmlFor="feed-enabled">
                Enabled
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="card-footer d-flex gap-2">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add feed'}
        </button>
        <button className="btn btn-outline-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
