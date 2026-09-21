import type { ReactNode } from 'react';

/**
 * One line of a list: a tick box, what to buy, and whatever the list wants to
 * put after it.
 *
 * The whole row is the tick target, not just the box. This is read off a phone
 * held in one hand in a supermarket, and a 24px checkbox is not something a
 * person finds while walking. Trailing controls sit outside that target so a
 * delete cannot be hit while aiming for a tick.
 */
export function TickRow({
  name,
  amount,
  meta,
  checked,
  onToggle,
  children,
}: {
  name: string;
  /** `1.5 kg`, or empty for a line that was never measured. */
  amount: string;
  /** The quiet second line — what it is for, or when it is needed. */
  meta?: ReactNode;
  checked: boolean;
  onToggle: () => void;
  /** Edit and delete buttons, outside the tick target. */
  children?: ReactNode;
}): JSX.Element {
  return (
    <li className={`tick-row${checked ? ' tick-row--checked' : ''}`}>
      <button
        type="button"
        className="tick-row__toggle"
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={`${name}${amount ? `, ${amount}` : ''}`}
      >
        <span className="tick-row__box" aria-hidden="true">
          <i className={`bi bi-${checked ? 'check-lg' : ''}`} />
        </span>
        <span className="tick-row__text">
          <span className="tick-row__name">
            {name}
            {amount && <span className="tick-row__amount">{amount}</span>}
          </span>
          {meta && <span className="tick-row__meta">{meta}</span>}
        </span>
      </button>
      {children && <span className="tick-row__actions">{children}</span>}
    </li>
  );
}
