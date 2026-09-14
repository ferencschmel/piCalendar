import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

/**
 * Picking a dish up and putting it down, by drag *or* by tap.
 *
 * Both gestures are the same state machine, and that is the point rather than
 * a convenience. A drag across a wall-mounted display is something not
 * everyone in a household can do — a child cannot reach the far column, and
 * nobody can do it one-handed carrying a pan — so tapping to lift and tapping
 * again to place is the interaction, with drag as the shortcut for whoever can
 * reach. Building drag first and bolting tap on afterwards produces two code
 * paths that disagree about what is held.
 *
 * Built on Pointer Events like {@link usePanGesture}, for the same reason: the
 * HTML5 drag-and-drop API does not fire on touch, which is the only input this
 * display has.
 */

/** What is currently in hand. */
export interface Held<T> {
  /** Identifies the source, so it can render itself as lifted. */
  key: string;
  payload: T;
  /** Where the pointer is, while dragging. `null` once it is a tap-held lift. */
  point: { x: number; y: number } | null;
}

/** Movement before a press becomes a drag rather than a tap. Matches the grid pan. */
const DRAG_THRESHOLD_PX = 6;

/**
 * How long a lifted dish waits before putting itself down.
 *
 * The same reasoning as the time grid's pan reset and the dashboard's period
 * anchors: nobody is looking after this display, and a dish left in hand by
 * whoever last walked past would still be hovering there in the morning.
 */
const IDLE_DROP_MS = 60_000;

export interface Placement<T> {
  held: Held<T> | null;
  /** Drop target under the pointer mid-drag, so it can light up. */
  hoverTarget: string | null;
  /** Spread onto anything that can be picked up. */
  sourceProps: (key: string, payload: T) => SourceProps;
  /** Spread onto anything that can be dropped on. */
  targetProps: (target: string) => TargetProps;
  /** Put the held item down on a target, by tap or programmatically. */
  place: (target: string) => void;
  cancel: () => void;
}

interface SourceProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  style: { touchAction: 'none' };
}

interface TargetProps {
  'data-drop-target': string;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}

/** The drop target under a screen point, or null if the pointer is over nothing. */
function targetAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  return element?.closest<HTMLElement>('[data-drop-target]')?.dataset.dropTarget ?? null;
}

export function usePlacement<T>(onPlace: (payload: T, target: string) => void): Placement<T> {
  const [held, setHeldState] = useState<Held<T> | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);

  /**
   * What is in hand, readable synchronously.
   *
   * The state above draws it; this decides what a drop does. Reading the state
   * inside a `setState` updater instead would put the placement side effect in
   * a function React is entitled to call more than once — which StrictMode
   * does, turning every drop into two requests and the second into a conflict.
   */
  const heldRef = useRef<Held<T> | null>(null);

  const setHeld = useCallback((next: Held<T> | null) => {
    heldRef.current = next;
    setHeldState(next);
  }, []);

  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    key: string;
    payload: T;
    active: boolean;
  } | null>(null);

  const cancel = useCallback(() => {
    drag.current = null;
    setHeld(null);
    setHoverTarget(null);
  }, [setHeld]);

  const place = useCallback(
    (target: string) => {
      const current = heldRef.current;
      // Cleared before the callback runs, so a second pointer event arriving
      // mid-request finds nothing in hand rather than placing the dish twice.
      drag.current = null;
      setHeld(null);
      setHoverTarget(null);

      if (current) onPlace(current.payload, target);
    },
    [onPlace, setHeld],
  );

  // Re-armed on every change to what is held, so the timer measures idleness
  // rather than the age of the lift.
  useEffect(() => {
    if (!held) return;
    const timer = window.setTimeout(cancel, IDLE_DROP_MS);
    return () => window.clearTimeout(timer);
  }, [held, cancel]);

  // Escape is the one keyboard affordance worth having here: the wall has no
  // keyboard, but the same page is planned from a laptop.
  useEffect(() => {
    if (!held) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [held, cancel]);

  const sourceProps = useCallback(
    (key: string, payload: T): SourceProps => ({
      style: { touchAction: 'none' },

      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          key,
          payload,
          active: false,
        };
      },

      onPointerMove: (event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;

        if (!current.active) {
          const moved =
            Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY);
          if (moved < DRAG_THRESHOLD_PX) return;
          current.active = true;
          // From here the gesture belongs to the source, so the pointer can
          // travel over any column without the events going to it instead.
          event.currentTarget.setPointerCapture(event.pointerId);
        }

        setHeld({ key, payload, point: { x: event.clientX, y: event.clientY } });
        setHoverTarget(targetAt(event.clientX, event.clientY));
      },

      onPointerUp: (event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        drag.current = null;

        if (current.active) {
          // Pointer capture means the event fired on the source however far the
          // finger travelled, so the drop target has to be read from the point.
          const target = targetAt(event.clientX, event.clientY);
          if (target) place(target);
          else cancel();
          return;
        }

        // A press that never moved is a tap: toggle the lift, so tapping the
        // same dish twice puts it back down rather than stranding it in hand.
        setHeld(heldRef.current?.key === key ? null : { key, payload, point: null });
        setHoverTarget(null);
      },

      onPointerCancel: cancel,
    }),
    [cancel, place, setHeld],
  );

  const targetProps = useCallback(
    (target: string): TargetProps => ({
      'data-drop-target': target,
      // Only fires for a tap-place: during a drag the source holds the capture,
      // and the drop is resolved from the pointer position instead. Reads the
      // ref rather than the state so these props stay stable across a lift.
      onPointerUp: () => {
        if (drag.current === null && heldRef.current !== null) place(target);
      },
    }),
    [place],
  );

  return { held, hoverTarget, sourceProps, targetProps, place, cancel };
}
