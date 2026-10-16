import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/layout/AppShell.jsx';
import { AuthProvider } from '../features/auth/AuthContext.jsx';
import { PublicOnly, RequireAuth } from '../features/auth/RouteGuards.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import RegisterPage from '../features/auth/RegisterPage.jsx';
import DashboardPage from '../features/dashboard/DashboardPage.jsx';
import DesignSystemPage from '../features/design-system/DesignSystemPage.jsx';
import SettingsPage from '../features/settings/SettingsPage.jsx';
import ContentLibraryPage from '../features/content/ContentLibraryPage.jsx';
import ContentFormPage from '../features/content/ContentFormPage.jsx';
import ContentDetailPage from '../features/content/ContentDetailPage.jsx';
import CalendarPage from '../features/calendar/CalendarPage.jsx';
import ClientsLibraryPage from '../features/clients/ClientsLibraryPage.jsx';
import ClientFormPage from '../features/clients/ClientFormPage.jsx';
import ClientDetailPage from '../features/clients/ClientDetailPage.jsx';
import { ToastProvider } from '../components/ui/index.js';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import { NAV_ITEMS } from '../lib/navigation.js';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/content" element={<ContentLibraryPage />} />
            <Route path="/content/new" element={<ContentFormPage mode="create" />} />
            <Route path="/content/:id" element={<ContentDetailPage />} />
            <Route path="/content/:id/edit" element={<ContentFormPage mode="edit" />} />
            <Route path="/brands" element={<ClientsLibraryPage />} />
            <Route path="/brands/new" element={<ClientFormPage mode="create" />} />
            <Route path="/brands/:id" element={<ClientDetailPage />} />
            <Route path="/brands/:id/edit" element={<ClientFormPage mode="edit" />} />
            {NAV_ITEMS.filter((i) => !['/dashboard', '/content', '/calendar', '/brands'].includes(i.path)).map((item) => (
              <Route key={item.path} path={`${item.path}/*`} element={<PlaceholderPage item={item} />} />
            ))}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
