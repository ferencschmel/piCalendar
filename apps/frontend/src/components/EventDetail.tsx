import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CalendarOccurrence } from '@picalendar/shared';
import {
  dateKey,
  durationLabel,
  longDateLabel,
  shortDateLabel,
  timeLabel,
} from '../utils/datetime.js';

/**
 * How long the popup stays up on its own. Long enough to read a description
 * from a couple of metres away, short enough that a wall display returns to
 * showing the week without anyone having to touch it.
 */
const AUTO_CLOSE_MS = 20_000;

/** Distance from the event block, and the closest the popup comes to an edge. */
const ANCHOR_GAP = 10;
const VIEWPORT_MARGIN = 8;

interface Props {
  occurrence: CalendarOccurrence;
  /**
   * The block that was tapped. Held as an element rather than a measured
   * rectangle so the popup can re-place itself if the page scrolls or the
   * window is resized while it is open.
   */
  anchor: HTMLElement;
  timezone: string;
  onClose: () => void;
}

interface Placement {
  top: number;
  left: number;
  /** Which side of the event the popup ended up on, for the pointer notch. */
  side: 'left' | 'right';
}

interface When {
  time: string;
  date: string;
  duration: string;
}

/**
 * The one-or-two lines that answer "when is this?". A same-day event leads with
 * its clock times and names the day underneath; one that crosses midnight has
 * to spell both dates out, so it uses a single line and drops the second.
 */
function describeWhen(occurrence: CalendarOccurrence, timezone: string): When {
  const { startsAt, endsAt, allDay } = occurrence;

  if (allDay) {
    // The stored end is the exclusive midnight after the event; step back
    // inside it so a single day does not read as spanning two.
    const lastDay = new Date(Date.parse(endsAt) - 1000).toISOString();
    const spansDays = dateKey(startsAt, timezone) !== dateKey(lastDay, timezone);

    return {
      time: 'All day',
      date: spansDays
        ? `${shortDateLabel(startsAt, timezone)} – ${shortDateLabel(lastDay, timezone)}`
        : longDateLabel(startsAt, timezone),
      duration: spansDays ? durationLabel(startsAt, endsAt) : '',
    };
  }

  if (dateKey(startsAt, timezone) !== dateKey(endsAt, timezone)) {
    return {
      time: `${shortDateLabel(startsAt, timezone)} ${timeLabel(startsAt, timezone)} → ${shortDateLabel(
        endsAt,
        timezone,
      )} ${timeLabel(endsAt, timezone)}`,
      date: '',
      duration: durationLabel(startsAt, endsAt),
    };
  }

  return {
    time: `${timeLabel(startsAt, timezone)} – ${timeLabel(endsAt, timezone)}`,
    date: longDateLabel(startsAt, timezone),
    duration: durationLabel(startsAt, endsAt),
  };
}

/** Beside the event if there is room, otherwise mirrored to its other side. */
function place(anchor: DOMRect, popup: DOMRect): Placement {
  const fitsRight = anchor.right + ANCHOR_GAP + popup.width + VIEWPORT_MARGIN <= window.innerWidth;
  const fitsLeft = anchor.left - ANCHOR_GAP - popup.width - VIEWPORT_MARGIN >= 0;
  const side: Placement['side'] = fitsRight || !fitsLeft ? 'right' : 'left';

  const rawLeft =
    side === 'right' ? anchor.right + ANCHOR_GAP : anchor.left - ANCHOR_GAP - popup.width;
  const maxLeft = window.innerWidth - popup.width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - popup.height - VIEWPORT_MARGIN;

  return {
    side,
    // A popup taller than the viewport is capped by CSS, so these clamps only
    // ever have to nudge it back inside — never squash it.
    left: Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), Math.max(maxLeft, VIEWPORT_MARGIN)),
    top: Math.min(Math.max(anchor.top, VIEWPORT_MARGIN), Math.max(maxTop, VIEWPORT_MARGIN)),
  };
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="event-detail__row">
      <i className={`bi bi-${icon} event-detail__row-icon`} aria-hidden="true" />
      <div className="event-detail__row-body">
        <span className="event-detail__row-label">{label}</span>
        <div className="event-detail__row-value">{children}</div>
      </div>
    </div>
  );
}

/**
 * Everything the feed said about one occurrence, in a card pinned beside the
 * block that was tapped — so it lands over the neighbouring day rather than
 * covering the event it describes.
 *
 * It closes on the × button, on Escape, on a tap anywhere outside it, and by
 * itself after {@link AUTO_CLOSE_MS}; the bar along the bottom shows how much
 * of that is left. A pointer resting on the card pauses the countdown and
 * restarts it on the way out, so it cannot vanish mid-sentence.
 */
export function EventDetail({ occurrence, anchor, timezone, onClose }: Props): JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [paused, setPaused] = useState(false);
  /** Bumped to restart both the timer and the bar that visualises it. */
  const [countdown, setCountdown] = useState(0);

  const when = describeWhen(occurrence, timezone);

  useLayoutEffect(() => {
    const reposition = (): void => {
      const popup = popupRef.current;
      if (!popup) return;

      const anchorBox = anchor.getBoundingClientRect();
      // The event left the board on a refresh: there is nothing to point at.
      if (!anchor.isConnected || (anchorBox.width === 0 && anchorBox.height === 0)) {
        onClose();
        return;
      }

      setPlacement(place(anchorBox, popup.getBoundingClientRect()));
    };

    reposition();
    window.addEventListener('resize', reposition);
    // Capture phase: the mobile layout scrolls an inner container, not the page.
    window.addEventListener('scroll', reposition, true);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [paused, countdown, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // `pointerdown` rather than `click`, so a tap on another event closes this
    // popup on the way down and opens that one on the way up.
    const onPointerDown = (event: Event): void => {
      if (!popupRef.current?.contains(event.target as Node)) onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // Take focus so the keyboard reaches the popup, and hand it back on close —
  // without scrolling, which on the mobile layout would jump the page.
  useEffect(() => {
    popupRef.current?.focus({ preventScroll: true });
    return () => {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  const status =
    occurrence.status && occurrence.status.toUpperCase() !== 'CONFIRMED'
      ? occurrence.status.toLowerCase()
      : null;

  return (
    <div
      ref={popupRef}
      className={`event-detail card event-detail--${placement?.side ?? 'right'}`}
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        // Rendered once to be measured, shown once it has somewhere to be.
        visibility: placement ? 'visible' : 'hidden',
      }}
      role="dialog"
      aria-labelledby="event-detail-title"
      tabIndex={-1}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        setPaused(false);
        setCountdown((cycle) => cycle + 1);
      }}
    >
      <div className="event-detail__accent" style={{ backgroundColor: occurrence.feedColor }} />

      <div className="event-detail__head">
        <span className="event-detail__feed">
          <span
            className="feed-dot"
            style={{ backgroundColor: occurrence.feedColor }}
            aria-hidden="true"
          />
          <span className="text-truncate">{occurrence.feedName}</span>
        </span>

        {occurrence.isRecurring && (
          <span className="event-detail__tag">
            <i className="bi bi-arrow-repeat" aria-hidden="true" /> Repeats
          </span>
        )}
        {status && <span className="event-detail__tag event-detail__tag--status">{status}</span>}

        <button
          type="button"
          className="btn-close event-detail__close"
          aria-label="Close event details"
          onClick={onClose}
        />
      </div>

      <div className="event-detail__body">
        <h2 className="event-detail__title" id="event-detail-title">
          {occurrence.summary}
        </h2>

        <div className="event-detail__when">
          <div className="event-detail__time">
            {when.time}
            {when.duration && <span className="event-detail__duration">{when.duration}</span>}
          </div>
          {when.date && <div className="event-detail__date">{when.date}</div>}
        </div>

        {occurrence.location && (
          <DetailRow icon="geo-alt" label="Location">
            {occurrence.location}
          </DetailRow>
        )}

        {occurrence.people.length > 0 && (
          <DetailRow icon="people" label="Who">
            <span className="event-detail__people">
              {occurrence.people.map((person) => (
                <span
                  key={person.id}
                  className="badge rounded-pill"
                  style={{ backgroundColor: person.color }}
                >
                  {person.displayName}
                </span>
              ))}
            </span>
          </DetailRow>
        )}

        {occurrence.organizer && (
          <DetailRow icon="person-badge" label="Organiser">
            {occurrence.organizer}
          </DetailRow>
        )}

        {occurrence.description && (
          <DetailRow icon="card-text" label="Details">
            <p className="event-detail__description">{occurrence.description}</p>
          </DetailRow>
        )}

        {occurrence.url && (
          <DetailRow icon="link-45deg" label="Link">
            <span className="event-detail__url">{occurrence.url}</span>
          </DetailRow>
        )}
      </div>

      <div className="event-detail__timer" aria-hidden="true">
        <div
          key={countdown}
          className="event-detail__timer-bar"
          style={{
            animationDuration: `${AUTO_CLOSE_MS}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}
