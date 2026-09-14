import { Outlet, useLocation } from 'react-router-dom';
import { AppNav } from './AppNav.js';

/**
 * Pages that size themselves to the viewport less the nav and let nothing
 * scroll, so they get the main area raw rather than the padded container.
 *
 * The dashboard, because it is the wall. The menu planner, because a week of
 * meals is seven columns and a rail, and it needs the whole screen for the
 * same reason the calendar does. The dish editor is an ordinary page and stays
 * out — it is read and typed into, not glanced at from across the room.
 */
const FULL_BLEED = new Set(['/', '/menu']);

/**
 * One frame for every page: the page itself, and the navigation bar along the
 * bottom.
 */
export function Layout(): JSX.Element {
  const isFullBleed = FULL_BLEED.has(useLocation().pathname);

  return (
    <div className="d-flex flex-column min-vh-100">
      <main className={isFullBleed ? 'flex-grow-1' : 'flex-grow-1 container-fluid py-4'}>
        <Outlet />
      </main>
      <AppNav />
    </div>
  );
}
