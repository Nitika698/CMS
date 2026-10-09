import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell.jsx';
import { AuthProvider } from '../features/auth/AuthContext.jsx';
import { PublicOnly, RequireAuth } from '../features/auth/RouteGuards.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import RegisterPage from '../features/auth/RegisterPage.jsx';
import DashboardPage from '../features/dashboard/DashboardPage.jsx';
import DesignSystemPage from '../features/design-system/DesignSystemPage.jsx';
import SettingsPage from '../features/settings/SettingsPage.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import { NAV_ITEMS } from '../lib/navigation.js';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            {NAV_ITEMS.filter((i) => i.path !== '/dashboard').map((item) => (
              <Route key={item.path} path={`${item.path}/*`} element={<PlaceholderPage item={item} />} />
            ))}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
