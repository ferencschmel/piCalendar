import type { Dish, Meal, PlannedDish, Wish } from '@picalendar/shared';

/**
 * What can be picked up on the menu page.
 *
 * One union rather than three separate drag hooks, because every source can be
 * dropped on every target and the page would otherwise need nine handlers for
 * what is really one question: "this thing, on that day".
 */
export type DragPayload =
  | { kind: 'dish'; dish: Dish }
  | { kind: 'wish'; wish: Wish }
  | { kind: 'entry'; entry: PlannedDish };

/** The wishlist panel, as a drop target. Dropping a dish here wishes for it. */
export const WISHLIST_TARGET = 'wishlist';

/** A cell of the planning grid: one meal on one day. */
export function targetKey(dayKey: string, meal: Meal): string {
  return `${dayKey}|${meal}`;
}

export function parseTargetKey(target: string): { dayKey: string; meal: Meal } | null {
  const [dayKey, meal] = target.split('|');
  return dayKey && meal ? { dayKey, meal: meal as Meal } : null;
}

/** What the drag ghost and the lifted-source styling both need to show. */
export function payloadLabel(payload: DragPayload): { name: string; icon: string; color: string } {
  switch (payload.kind) {
    case 'dish':
      return { name: payload.dish.name, icon: payload.dish.icon, color: payload.dish.color };
    case 'wish':
      return { name: payload.wish.dishName, icon: payload.wish.icon, color: payload.wish.color };
    case 'entry':
      return { name: payload.entry.name, icon: payload.entry.icon, color: payload.entry.color };
  }
}
