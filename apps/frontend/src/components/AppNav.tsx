import { NavLink } from 'react-router-dom';

/**
 * The display's only persistent chrome: one row of destinations along the
 * bottom edge, identical on every page.
 *
 * Bottom rather than top because the calendar is wall-mounted and reached by
 * hand — the bottom edge is the part of a large screen a person can actually
 * touch without stretching. Each entry carries an icon *and* a word: the icons
 * alone would be a guessing game for a household member who uses this twice a
 * week, and there is room for both.
 */

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

/**
 * Calendar first because it is what the wall shows all day; settings last
 * because it is the one entry nobody is meant to need.
 */
const ITEMS: NavItem[] = [
  { to: '/', label: 'Calendar', icon: 'calendar3' },
  { to: '/tasks', label: 'Tasks', icon: 'check2-square' },
  { to: '/menu', label: 'Menu', icon: 'egg-fried' },
  { to: '/lists', label: 'Lists', icon: 'list-ul' },
  { to: '/admin', label: 'Settings', icon: 'gear' },
];

export function AppNav(): JSX.Element {
  return (
    <nav className="app-nav" aria-label="Main">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          // Without `end` the calendar's `/` would match every other route and
          // two entries would read as current at once.
          end={item.to === '/'}
          className={({ isActive }) => `app-nav__item${isActive ? ' app-nav__item--active' : ''}`}
        >
          <i className={`bi bi-${item.icon} app-nav__icon`} aria-hidden="true" />
          <span className="app-nav__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
