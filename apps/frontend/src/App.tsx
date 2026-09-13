import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { MenuPage } from './pages/MenuPage.js';
import { ListsPage } from './pages/ListsPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="lists" element={<ListsPage />} />
        {/* Reached as "Settings" in the nav; the path predates the word and is
            what the docs and any bookmarked link still use. */}
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
