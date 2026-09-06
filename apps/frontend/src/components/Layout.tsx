import { NavLink, Outlet, useLocation } from 'react-router-dom';

/**
 * The dashboard runs full-bleed on the wall display, so the navbar is hidden
 * there and reachable by a corner tap — an admin affordance that does not eat
 * screen space the calendar wants.
 */
export function Layout(): JSX.Element {
  const isDashboard = useLocation().pathname === '/';

  return (
    <div className="d-flex flex-column min-vh-100">
      {isDashboard ? (
        <NavLink
          to="/admin"
          className="dashboard-admin-hotspot"
          aria-label="Open administration"
          title="Administration"
        >
          <i className="bi bi-gear" aria-hidden="true" />
        </NavLink>
      ) : (
        <nav className="navbar navbar-expand bg-body-tertiary border-bottom">
          <div className="container-fluid">
            <NavLink className="navbar-brand d-flex align-items-center gap-2" to="/">
              <i className="bi bi-calendar3" aria-hidden="true" />
              <span>piCalendar</span>
            </NavLink>
            <div className="navbar-nav">
              <NavLink className="nav-link" to="/">
                Dashboard
              </NavLink>
              <NavLink className="nav-link" to="/admin">
                Administration
              </NavLink>
            </div>
          </div>
        </nav>
      )}

      <main className={isDashboard ? 'flex-grow-1' : 'flex-grow-1 container-fluid py-4'}>
        <Outlet />
      </main>
    </div>
  );
}
