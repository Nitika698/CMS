import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell.jsx';
import DashboardPage from '../features/dashboard/DashboardPage.jsx';
import DesignSystemPage from '../features/design-system/DesignSystemPage.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import { NAV_ITEMS } from '../lib/navigation.js';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        {NAV_ITEMS.filter((i) => i.path !== '/dashboard').map((item) => (
          <Route key={item.path} path={`${item.path}/*`} element={<PlaceholderPage item={item} />} />
        ))}
        <Route path="/design-system" element={<DesignSystemPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
