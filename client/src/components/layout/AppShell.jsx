import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar mobileOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="lg:pl-64">
        <Topbar onMenu={() => setDrawerOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
