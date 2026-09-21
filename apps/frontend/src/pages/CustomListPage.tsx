import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  SUGGESTED_UNITS,
  listProgressLabel,
  type CustomList,
  type ListItem,
} from '@picalendar/shared';
import { api } from '../api/client.js';
import { usePendingTicks } from '../hooks/usePendingTicks.js';
import { usePolling } from '../hooks/usePolling.js';
import { TickRow } from '../components/TickRow.js';

/**
 * One list somebody wrote: a name, and items with amounts that can be ticked
 * off.
 *
 * Remounted per id, for the same reason the dish editor is: a half-typed item
 * belongs to the list it was being typed onto and must not follow anyone onto
 * the next one.
 */
export function CustomListPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <CustomListView key={id} id={id ?? ''} />;
}

const LIST_POLL_MS = 30_000;

/**
 * A quantity as typed, kept as text until it is saved. A number input that
 * reads back as a number cannot tell `""` from `0`, nor hold `1.` while
 * someone is still typing `1.5` — both of which make the field fight the
 * person using it.
 */
function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function CustomListView({ id }: { id: string }): JSX.Element {
  const navigate = useNavigate();
  const poll = usePolling(() => api.getList(id), LIST_POLL_MS, [id]);
  const { data, lastUpdatedAt, refresh } = poll;

  const [error, setError] = useState<string | null>(null);
  /** The item whose text is open for editing, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const { mark, settle, forget, resolve } = usePendingTicks(lastUpdatedAt);

  const toggle = useCallback(
    async (item: ListItem, checked: boolean) => {
      mark(item.id, checked);
      setError(null);
      try {
        await api.updateListItem(id, item.id, { checked });
        settle(item.id);
      } catch {
        forget(item.id);
        setError('That tick did not save. Check the connection?');
      }
      refresh();
    },
    [forget, id, mark, refresh, settle],
  );

  const remove = useCallback(
    async (item: ListItem) => {
      try {
        await api.deleteListItem(id, item.id);
      } catch {
        setError('Could not remove that item.');
      }
      refresh();
    },
    [id, refresh],
  );

  const clearChecked = useCallback(async () => {
    try {
      await api.clearCheckedItems(id);
    } catch {
      setError('Could not clear the ticked items.');
    }
    refresh();
  }, [id, refresh]);

  const dropList = useCallback(async () => {
    try {
      await api.deleteList(id);
      navigate('/lists');
    } catch {
      setError('Could not delete that list.');
    }
  }, [id, navigate]);

  if (poll.loading) return <p className="text-body-secondary">Loading…</p>;

  if (!data) {
    return (
      <div className="list-page">
        <div className="alert alert-warning" role="alert">
          That list could not be loaded. <Link to="/lists">Back to the lists</Link>
        </div>
      </div>
    );
  }

  const items = data.items;
  const checkedCount = items.filter((item) => resolve(item.id, item.checked)).length;

  return (
    <div className="list-page">
      <div className="list-page__sticky">
        <header className="list-page__header">
          <Link to="/lists" className="list-page__back">
            <i className="bi bi-chevron-left" aria-hidden="true" />
            <span>Lists</span>
          </Link>
          <h1 className="h4 mb-0">{data.name}</h1>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary ms-auto"
            onClick={() => setRenaming((open) => !open)}
            aria-expanded={renaming}
          >
            <i className="bi bi-three-dots" aria-hidden="true" />
            <span className="visually-hidden">List options</span>
          </button>
        </header>

        {renaming && (
          <ListOptions
            list={data}
            onDone={() => {
              setRenaming(false);
              refresh();
            }}
            onDelete={() => void dropList()}
          />
        )}

        <AddItemForm listId={id} onAdded={refresh} onError={setError} />

        <p className="list-page__summary">
          {listProgressLabel(items.length, checkedCount, 'done')}
        </p>
      </div>

      {error && (
        <div className="alert alert-warning py-2" role="alert">
          {error}
        </div>
      )}

      {items.length === 0 && (
        <div className="list-page__empty">
          <i className="bi bi-card-checklist list-page__empty-icon" aria-hidden="true" />
          <p className="mb-0">Nothing on this list yet.</p>
        </div>
      )}

      {/* Ticked items stay where they were written, unlike the grocery list's.
          That list is regenerated and cannot be reordered by hand, so sinking
          what is bought is the only organisation it has; this one's order is
          somebody's, and rearranging it under them would fight the author. The
          button at the bottom is how a finished list is cleared. */}
      <ul className="tick-list">
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id} className="tick-row tick-row--editing">
              <ItemEditor
                listId={id}
                item={item}
                onDone={() => {
                  setEditing(null);
                  refresh();
                }}
              />
            </li>
          ) : (
            <TickRow
              key={item.id}
              name={item.name}
              amount={item.amount}
              checked={resolve(item.id, item.checked)}
              onToggle={() => void toggle(item, !resolve(item.id, item.checked))}
            >
              <button
                type="button"
                className="tick-row__action"
                onClick={() => setEditing(item.id)}
                aria-label={`Edit ${item.name}`}
              >
                <i className="bi bi-pencil" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="tick-row__action"
                onClick={() => void remove(item)}
                aria-label={`Remove ${item.name}`}
              >
                <i className="bi bi-trash" aria-hidden="true" />
              </button>
            </TickRow>
          ),
        )}
      </ul>

      {checkedCount > 0 && (
        <button
          type="button"
          className="btn btn-outline-secondary w-100 mt-3"
          onClick={() => void clearChecked()}
        >
          <i className="bi bi-check2-all me-1" aria-hidden="true" />
          Clear the {checkedCount} ticked
        </button>
      )}
    </div>
  );
}

/**
 * The form that fills the list, at the top and sticky.
 *
 * Name on its own line and the measure under it, because on a phone the name
 * is what is being typed and the amount is often left blank — "bread" is a
 * complete line. Submitting keeps the focus where it is, so a run of items
 * goes in without a tap between them.
 */
function AddItemForm({
  listId,
  onAdded,
  onError,
}: {
  listId: string;
  onAdded: () => void;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (name.trim() === '' || busy) return;

      setBusy(true);
      onError(null);
      try {
        await api.addListItem(listId, { name, quantity: parseQuantity(quantity), unit });
        setName('');
        setQuantity('');
        setUnit('');
        onAdded();
      } catch {
        onError('Could not add that item.');
      } finally {
        setBusy(false);
      }
    },
    [busy, listId, name, onAdded, onError, quantity, unit],
  );

  return (
    <form className="item-form" onSubmit={submit}>
      <div className="input-group input-group-lg">
        <input
          className="form-control"
          value={name}
          maxLength={120}
          placeholder="Add an item"
          aria-label="Item"
          onChange={(event) => setName(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || name.trim() === ''}>
          <i className="bi bi-plus-lg" aria-hidden="true" />
          <span className="visually-hidden">Add</span>
        </button>
      </div>
      <div className="item-form__measure">
        <input
          className="form-control"
          value={quantity}
          inputMode="decimal"
          placeholder="Qty"
          aria-label="Quantity"
          onChange={(event) => setQuantity(event.target.value)}
        />
        <input
          className="form-control"
          value={unit}
          list="list-units"
          maxLength={20}
          placeholder="Unit"
          aria-label="Unit"
          onChange={(event) => setUnit(event.target.value)}
        />
        <datalist id="list-units">
          {SUGGESTED_UNITS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </div>
    </form>
  );
}

/** An item opened for correction, in place, with the row's own controls. */
function ItemEditor({
  listId,
  item,
  onDone,
}: {
  listId: string;
  item: ListItem;
  onDone: () => void;
}): JSX.Element {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity === null ? '' : String(item.quantity));
  const [unit, setUnit] = useState(item.unit);
  const [busy, setBusy] = useState(false);

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (name.trim() === '' || busy) return;
      setBusy(true);
      try {
        await api.updateListItem(listId, item.id, {
          name,
          quantity: parseQuantity(quantity),
          unit,
        });
      } finally {
        setBusy(false);
        onDone();
      }
    },
    [busy, item.id, listId, name, onDone, quantity, unit],
  );

  return (
    <form className="item-form item-form--inline" onSubmit={save}>
      <input
        className="form-control"
        value={name}
        maxLength={120}
        aria-label="Item"
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <div className="item-form__measure">
        <input
          className="form-control"
          value={quantity}
          inputMode="decimal"
          placeholder="Qty"
          aria-label="Quantity"
          onChange={(event) => setQuantity(event.target.value)}
        />
        <input
          className="form-control"
          value={unit}
          list="list-units"
          maxLength={20}
          placeholder="Unit"
          aria-label="Unit"
          onChange={(event) => setUnit(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Save
        </button>
        <button className="btn btn-outline-secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Rename or throw away the whole list, behind the header's menu button. */
function ListOptions({
  list,
  onDone,
  onDelete,
}: {
  list: CustomList;
  onDone: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [name, setName] = useState(list.name);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const rename = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (name.trim() === '' || busy) return;
      setBusy(true);
      try {
        await api.renameList(list.id, name);
      } finally {
        setBusy(false);
        onDone();
      }
    },
    [busy, list.id, name, onDone],
  );

  return (
    <div className="list-page__options">
      <form className="input-group" onSubmit={rename}>
        <input
          className="form-control"
          value={name}
          maxLength={60}
          aria-label="List name"
          onChange={(event) => setName(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Rename
        </button>
      </form>
      {confirming ? (
        <p className="list-page__confirm">
          <span>
            Delete “{list.name}” and its {list.items.length}{' '}
            {list.items.length === 1 ? 'item' : 'items'}?
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
            Delete
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-outline-danger"
          onClick={() => setConfirming(true)}
        >
          <i className="bi bi-trash me-1" aria-hidden="true" />
          Delete this list
        </button>
      )}
    </div>
  );
}
