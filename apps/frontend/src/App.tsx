import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { TaskListPage } from './pages/TaskListPage.js';
import { TaskEditorPage } from './pages/TaskEditorPage.js';
import { MenuPage } from './pages/MenuPage.js';
import { DishEditorPage } from './pages/DishEditorPage.js';
import { ListsPage } from './pages/ListsPage.js';
import { GroceryListPage } from './pages/GroceryListPage.js';
import { CustomListPage } from './pages/CustomListPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        {/* Nested under /tasks so the nav's Tasks entry stays lit while a chore
            is being written up — it is the same errand, not a separate
            section. Both fixed paths come before `:id`, which would otherwise
            swallow them and go looking for a task called "new". */}
        <Route path="tasks/new" element={<TaskEditorPage />} />
        <Route path="tasks/all" element={<TaskListPage />} />
        <Route path="tasks/:id" element={<TaskEditorPage />} />
        <Route path="menu" element={<MenuPage />} />
        {/* Nested under /menu so the nav's Menu entry stays lit while a dish is
            being written up — it is the same errand, not a separate section. */}
        <Route path="menu/dishes/new" element={<DishEditorPage />} />
        <Route path="menu/dishes/:id" element={<DishEditorPage />} />
        <Route path="lists" element={<ListsPage />} />
        {/* Before the parameterised route: the grocery list is derived from
            the menu rather than stored, so there is no list row with this id
            for `:id` to find. */}
        <Route path="lists/grocery" element={<GroceryListPage />} />
        <Route path="lists/:id" element={<CustomListPage />} />
        {/* Reached as "Settings" in the nav; the path predates the word and is
            what the docs and any bookmarked link still use. */}
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
