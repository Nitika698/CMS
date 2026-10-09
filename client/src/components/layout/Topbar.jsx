import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, LogOut, Menu, Search, Settings, UserCircle2 } from 'lucide-react';
import { findNavItem } from '../../lib/navigation.js';
import { Popover, EmptyState, Modal, Input, Badge } from '../ui/index.js';
import { useAuth } from '../../features/auth/AuthContext.jsx';

function pageTitle(pathname) {
  if (pathname.startsWith('/design-system')) return 'Design system';
  if (pathname.startsWith('/settings')) return 'Settings';
  return findNavItem(pathname)?.label ?? 'CreatorDesk';
}

function NotificationsMenu() {
  return (
    <Popover
      width="w-80"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          aria-label="Notifications"
          aria-expanded={open}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <Bell className="h-5 w-5" />
        </button>
      )}
    >
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Notifications</div>
      <EmptyState
        icon={Bell}
        title="No notifications"
        description="Reminders for posts, tasks and payments will appear here once those modules are built."
      />
    </Popover>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  return (
    <Popover
      width="w-64"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          aria-label="Profile menu"
          aria-expanded={open}
          className="rounded-full p-1 text-slate-500 hover:bg-slate-100"
        >
          <UserCircle2 className="h-7 w-7" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="text-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate font-semibold text-slate-900">{user.name}</p>
            <p className="truncate text-slate-500">{user.email}</p>
          </div>
          <div className="p-1.5">
            <Link
              to="/settings"
              onClick={close}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100"
            >
              <Settings className="h-4 w-4" aria-hidden /> Profile &amp; settings
            </Link>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function SearchEntry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-500 hover:bg-slate-100 sm:w-56 sm:px-3"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Search…</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search" align="top">
        <Input disabled placeholder="Search content, brands, campaigns…" aria-label="Search (not available yet)" />
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Badge tone="warning">Placeholder</Badge> Global search is not implemented yet.
        </p>
      </Modal>
    </>
  );
}

export default function Topbar({ onMenu }) {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} aria-label="Open menu" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>
      <h1 className="truncate text-lg font-semibold text-slate-900">{pageTitle(pathname)}</h1>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <SearchEntry />
        <NotificationsMenu />
        <ProfileMenu />
      </div>
    </header>
  );
}
