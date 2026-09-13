import { Outlet, useLocation } from 'react-router-dom';
import { AppNav } from './AppNav.js';

/**
 * One frame for every page: the page itself, and the navigation bar along the
 * bottom.
 *
 * The dashboard runs full-bleed — it sizes itself to the viewport less the nav
 * and lets nothing scroll — so it gets the main area raw, without the padding
 * and container the ordinary pages want.
 */
export function Layout(): JSX.Element {
  const isDashboard = useLocation().pathname === '/';

  return (
    <div className="d-flex flex-column min-vh-100">
      <main className={isDashboard ? 'flex-grow-1' : 'flex-grow-1 container-fluid py-4'}>
        <Outlet />
      </main>
      <AppNav />
    </div>
  );
}
