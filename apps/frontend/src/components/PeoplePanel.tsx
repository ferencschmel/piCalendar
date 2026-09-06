import { useState, type FormEvent } from 'react';
import type { Person, PersonInput } from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';

interface Props {
  people: Person[];
  onChanged: () => void;
}

function emptyDraft(): PersonInput {
  return { displayName: '', email: '', color: '#6c757d', active: true };
}

/**
 * People exist mainly so feeds can be attributed to someone. That attribution
 * is what the camera will key off later — a person here is the identity the
 * detector will eventually match a face to.
 */
export function PeoplePanel({ people, onChanged }: Props): JSX.Element {
  const [draft, setDraft] = useState<PersonInput>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createPerson(draft);
      setDraft(emptyDraft());
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add person');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(person: Person): Promise<void> {
    if (!window.confirm(`Remove ${person.displayName}? Their feeds stay, but lose the link.`)) {
      return;
    }
    try {
      await api.deletePerson(person.id);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not remove person');
    }
  }

  return (
    <div className="card">
      <div className="card-header">People</div>

      <ul className="list-group list-group-flush">
        {people.length === 0 && (
          <li className="list-group-item text-body-secondary fst-italic">No one added yet.</li>
        )}
        {people.map((person) => (
          <li
            key={person.id}
            className="list-group-item d-flex align-items-center justify-content-between"
          >
            <span className="d-flex align-items-center gap-2">
              <span
                className="feed-dot"
                style={{ backgroundColor: person.color }}
                aria-hidden="true"
              />
              <span>{person.displayName}</span>
              {!person.active && <span className="badge text-bg-secondary">inactive</span>}
            </span>
            <button
              className="btn btn-sm btn-outline-danger"
              type="button"
              onClick={() => void handleDelete(person)}
              aria-label={`Remove ${person.displayName}`}
            >
              <i className="bi bi-trash" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <form className="card-body border-top" onSubmit={(e) => void handleSubmit(e)}>
        {error && (
          <div className="alert alert-danger py-2" role="alert">
            {error}
          </div>
        )}
        <div className="row g-2 align-items-end">
          <div className="col-7">
            <label className="form-label" htmlFor="person-name">
              Name
            </label>
            <input
              id="person-name"
              className="form-control form-control-sm"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              required
            />
          </div>
          <div className="col-3">
            <label className="form-label" htmlFor="person-color">
              Colour
            </label>
            <input
              id="person-color"
              type="color"
              className="form-control form-control-color form-control-sm w-100"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
          </div>
          <div className="col-2">
            <button className="btn btn-sm btn-primary w-100" type="submit" disabled={busy}>
              Add
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
