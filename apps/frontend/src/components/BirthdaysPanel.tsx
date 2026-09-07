import { useState, type FormEvent } from 'react';
import {
  DEFAULT_BIRTHDAY_COLOR,
  DEFAULT_BIRTHDAY_ICON,
  suggestedIcons,
  type Birthday,
  type BirthdayDate,
  type BirthdayInputPayload,
} from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';

interface Props {
  birthdays: Birthday[];
  onChanged: () => void;
}

/**
 * The form's own shape. `<input type="date">` only speaks `YYYY-MM-DD`, so a
 * birthday with no year is held as a date plus a flag rather than as the
 * three-part value the API takes — {@link toDate} converts at the one point it
 * matters.
 */
interface Draft {
  displayName: string;
  color: string;
  icon: string;
  date: string;
  yearKnown: boolean;
}

/** Stands in for the year when it is not known, so the date input stays usable. */
const PLACEHOLDER_YEAR = '2000';

function emptyDraft(): Draft {
  return {
    displayName: '',
    color: DEFAULT_BIRTHDAY_COLOR,
    icon: DEFAULT_BIRTHDAY_ICON,
    date: '',
    yearKnown: true,
  };
}

function draftOf(birthday: Birthday): Draft {
  const { date } = birthday;
  return {
    displayName: birthday.displayName,
    color: birthday.color,
    icon: birthday.icon,
    date: [
      String(date.year ?? PLACEHOLDER_YEAR),
      String(date.month).padStart(2, '0'),
      String(date.day).padStart(2, '0'),
    ].join('-'),
    yearKnown: date.year !== null,
  };
}

function toDate(draft: Draft): BirthdayDate | null {
  const [year, month, day] = draft.date.split('-').map(Number);
  if (!year || !month || !day) return null;
  return { month, day, year: draft.yearKnown ? year : null };
}

/** `3 March 2017`, or `3 March` when the year is not on file. */
function dateText(date: BirthdayDate): string {
  return new Date(Date.UTC(date.year ?? 2000, date.month - 1, date.day)).toLocaleDateString(
    'en-GB',
    {
      day: 'numeric',
      month: 'long',
      ...(date.year === null ? {} : { year: 'numeric' }),
      timeZone: 'UTC',
    },
  );
}

/**
 * Birthdays are their own list, not a field on a person.
 *
 * The people above are household members that feeds are attributed to and that
 * the camera will one day recognise. The names here are grandparents, cousins
 * and school friends — nobody whose calendar is subscribed to or whose face the
 * Pi will ever see — so they get a record with only what a birthday needs.
 *
 * Editing matters more here than on the feed list: a mistyped birth year is
 * invisible until the wrong age appears on the wall months later.
 */
export function BirthdaysPanel({ birthdays, onChanged }: Props): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startAdding(): void {
    setEditing(null);
    setDraft(emptyDraft());
    setError(null);
  }

  function startEditing(birthday: Birthday): void {
    setEditing(birthday.id);
    setDraft(draftOf(birthday));
    setError(null);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const date = toDate(draft);
    if (!date) {
      setError('A birthday needs a date');
      return;
    }

    setBusy(true);
    setError(null);
    // `active` is absent from the form: on a create the schema defaults it, and
    // on a patch anything omitted is left alone.
    const payload: BirthdayInputPayload = {
      displayName: draft.displayName,
      date,
      icon: draft.icon,
      color: draft.color,
    };
    try {
      if (editing) await api.updateBirthday(editing, payload);
      else await api.createBirthday(payload);
      startAdding();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the birthday');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(birthday: Birthday): Promise<void> {
    if (!window.confirm(`Remove ${birthday.displayName}'s birthday?`)) return;
    try {
      await api.deleteBirthday(birthday.id);
      if (editing === birthday.id) startAdding();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not remove the birthday');
    }
  }

  return (
    <div className="card">
      <div className="card-header">Birthdays</div>

      <ul className="list-group list-group-flush">
        {birthdays.length === 0 && (
          <li className="list-group-item text-body-secondary fst-italic">
            No birthdays yet. These are separate from the people above — anyone at all can have one.
          </li>
        )}
        {birthdays.map((birthday) => (
          <li
            key={birthday.id}
            className={`list-group-item d-flex align-items-center justify-content-between ${
              editing === birthday.id ? 'list-group-item-primary' : ''
            }`}
          >
            <span className="d-flex align-items-center gap-2 min-w-0">
              <i
                className={`bi ${birthday.icon}`}
                style={{ color: birthday.color }}
                aria-hidden="true"
              />
              <span className="text-truncate">{birthday.displayName}</span>
              {/* Outlined rather than filled: a solid badge would have to pick
                  a background, and the admin page follows the browser's light
                  or dark theme. */}
              <span className="badge border border-secondary-subtle text-body-secondary fw-normal">
                {dateText(birthday.date)}
              </span>
              {!birthday.active && <span className="badge text-bg-secondary">hidden</span>}
            </span>
            <span className="d-flex gap-1 flex-shrink-0">
              <button
                className="btn btn-sm btn-outline-secondary"
                type="button"
                onClick={() => startEditing(birthday)}
                aria-label={`Edit ${birthday.displayName}`}
              >
                <i className="bi bi-pencil" aria-hidden="true" />
              </button>
              <button
                className="btn btn-sm btn-outline-danger"
                type="button"
                onClick={() => void handleDelete(birthday)}
                aria-label={`Remove ${birthday.displayName}`}
              >
                <i className="bi bi-trash" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form className="card-body border-top" onSubmit={(e) => void handleSubmit(e)}>
        {error && (
          <div className="alert alert-danger py-2" role="alert">
            {error}
          </div>
        )}

        <div className="row g-2">
          <div className="col-9">
            <label className="form-label" htmlFor="birthday-name">
              Name
            </label>
            <input
              id="birthday-name"
              className="form-control form-control-sm"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              required
            />
          </div>
          <div className="col-3">
            <label className="form-label" htmlFor="birthday-color">
              Colour
            </label>
            <input
              id="birthday-color"
              type="color"
              className="form-control form-control-color form-control-sm w-100"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
          </div>

          <div className="col-12">
            <label className="form-label" htmlFor="birthday-date">
              Date
            </label>
            <input
              id="birthday-date"
              type="date"
              className="form-control form-control-sm"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              required
            />
            <div className="form-check form-check-inline mt-1">
              <input
                id="birthday-year-unknown"
                type="checkbox"
                className="form-check-input"
                checked={!draft.yearKnown}
                disabled={!draft.date}
                onChange={(e) => setDraft({ ...draft, yearKnown: !e.target.checked })}
              />
              <label className="form-check-label small" htmlFor="birthday-year-unknown">
                {/* The year is what turns a birthday into an age, so its absence
                    has to be a deliberate tick rather than a blank field. */}
                Year unknown — show the day without an age
              </label>
            </div>
          </div>

          <fieldset className="col-12">
            <legend className="form-label fs-6">Icon</legend>
            <div className="person-icons" role="radiogroup" aria-label="Icon">
              {suggestedIcons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  role="radio"
                  aria-checked={draft.icon === icon}
                  aria-label={icon.replace('bi-', '').replace(/-/g, ' ')}
                  className={`btn btn-sm ${
                    draft.icon === icon ? 'btn-primary' : 'btn-outline-secondary'
                  }`}
                  onClick={() => setDraft({ ...draft, icon })}
                >
                  <i className={`bi ${icon}`} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          <div className="col-12 d-flex gap-2">
            <button className="btn btn-sm btn-primary flex-grow-1" type="submit" disabled={busy}>
              {editing ? 'Save changes' : 'Add birthday'}
            </button>
            {editing && (
              <button
                className="btn btn-sm btn-outline-secondary"
                type="button"
                onClick={startAdding}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
