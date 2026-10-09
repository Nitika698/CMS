import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '../../components/ui/index.js';
import { useAuth } from './AuthContext.jsx';

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Checking your session…" />
    </div>
  );
}

/** Everything under this route requires a signed-in user; others are sent to /login and returned afterwards. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoading />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Login/signup pages: signed-in users are bounced to the app. */
export function PublicOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoading />;
  if (status === 'authenticated') {
    const from = location.state?.from;
    return <Navigate to={from ? `${from.pathname}${from.search}` : '/dashboard'} replace />;
  }
  return <Outlet />;
}
