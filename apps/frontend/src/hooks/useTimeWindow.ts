import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  DEFAULT_WINDOW_START_MINUTE,
  MINUTES_PER_DAY,
  clampWindowStart,
  windowFromStart,
  windowMinutes,
  type TimeWindow,
} from '../utils/timeline.js';

/**
 * Which twelve hours of the day the grid is showing, and the gesture that
 * changes it.
 *
 * The band is deliberately narrower than the day so the hour rows stay tall
 * enough to read across a room, which means the early and late edges of a
 * household's day live just off screen. Dragging the grid brings them back.
 */

/**
 * How long a panned grid waits before sliding back to the default band.
 *
 * The pan is an *override*, for the same reason the month anchor is: nobody is
 * looking after this display, and a grid left at 22:00 by whoever last walked
 * past would still be there in the morning. Long enough to read what you
 * dragged to, short enough that the wall corrects itself.
 */
const IDLE_RESET_MS = 120_000;

/** Movement before a press on a block becomes a drag of the grid under it. */
const DRAG_THRESHOLD_PX = 6;

/** A wheel notch in line mode, in the pixels the browser would have scrolled. */
const WHEEL_LINE_HEIGHT_PX = 16;

export interface TimeWindowControl {
  timeWindow: TimeWindow;
  /** Move the band; positive minutes go later in the day. */
  pan: (deltaMinutes: number) => void;
  canPanEarlier: boolean;
  canPanLater: boolean;
}

export function useTimeWindow(): TimeWindowControl {
  const [startMinute, setStartMinute] = useState(DEFAULT_WINDOW_START_MINUTE);

  const pan = useCallback((deltaMinutes: number) => {
    setStartMinute((current) => clampWindowStart(current + deltaMinutes));
  }, []);

  // Re-armed by every pan, because each one changes `startMinute` and so
  // re-runs this effect; it cancels itself once the band is home again.
  useEffect(() => {
    if (startMinute === DEFAULT_WINDOW_START_MINUTE) return;
    const timer = window.setTimeout(
      () => setStartMinute(DEFAULT_WINDOW_START_MINUTE),
      IDLE_RESET_MS,
    );
    return () => window.clearTimeout(timer);
  }, [startMinute]);

  const timeWindow = useMemo(() => windowFromStart(startMinute), [startMinute]);

  return {
    timeWindow,
    pan,
    canPanEarlier: timeWindow.startMinute > 0,
    canPanLater: timeWindow.endMinute < MINUTES_PER_DAY,
  };
}

/** Spread onto the element whose vertical drag pans the grid. */
export interface PanHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
}

/**
 * Drag-to-pan for the time grid.
 *
 * The gesture is measured against the height of the element it started on, so a
 * drag moves the hour lines exactly as far as the finger — the grid comes with
 * the hand rather than at some multiple of it, which is the only version of
 * this that feels right on a touch display.
 *
 * The handlers go on the timeline container, so a press that lands on an event
 * block still pans; the block only keeps the gesture if it turns out to be a tap
 * rather than a drag.
 */
export function usePanGesture(
  pan: (deltaMinutes: number) => void,
  timeWindow: TimeWindow,
): PanHandlers {
  const visibleMinutes = windowMinutes(timeWindow);

  const drag = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    minutesPerPixel: number;
    active: boolean;
  } | null>(null);

  // A drag that ends on an event block would otherwise open its popup on the
  // way out of the gesture.
  const swallowClick = useRef(false);

  const minutesPerPixel = useCallback(
    (element: HTMLElement) => visibleMinutes / Math.max(element.clientHeight, 1),
    [visibleMinutes],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      // A drag released off the grid never produces the click that would clear
      // the flag, so the next press does it instead.
      swallowClick.current = false;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      drag.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        minutesPerPixel: minutesPerPixel(event.currentTarget),
        active: false,
      };
    },
    [minutesPerPixel],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;

      if (!current.active) {
        if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) return;
        current.active = true;
        // From here the gesture belongs to the grid, whatever it started on.
        event.currentTarget.setPointerCapture(event.pointerId);
        current.lastY = event.clientY;
        return;
      }

      // Dragging the grid *up* reveals later hours, the way a sheet of paper
      // pushed up shows what was below it.
      pan(-(event.clientY - current.lastY) * current.minutesPerPixel);
      current.lastY = event.clientY;
    },
    [pan],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.active) swallowClick.current = true;
    drag.current = null;
  }, []);

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  const onWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      const pixels = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_HEIGHT_PX : event.deltaY;
      pan(pixels * minutesPerPixel(event.currentTarget));
    },
    [minutesPerPixel, pan],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onClickCapture,
    onWheel,
  };
}
