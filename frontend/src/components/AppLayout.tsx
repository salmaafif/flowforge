import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

interface Crumb {
  label: string;
  to?: string;
}

interface AppLayoutProps {
  title?: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Authenticated app shell: a persistent sidebar (brand + navigation + the signed-in
 * user) and a main column with a breadcrumb/title header. Every protected page
 * renders inside this so navigation and context stay consistent.
 */
export function AppLayout({ title, subtitle, breadcrumbs, actions, children }: AppLayoutProps) {
  const { auth, logout } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Flow<span className="text-indigo-600">Forge</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 px-3 pt-2">
          <p className="px-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">
            Menu
          </p>
          <SidebarLink to="/" end icon={<GridIcon />}>
            Dashboard
          </SidebarLink>
          <SidebarLink to="/workflows" end icon={<WorkflowsIcon />}>
            Workflows
          </SidebarLink>
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
              {(auth?.user.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{auth?.user.email}</p>
              <p className="text-xs text-slate-400">{auth?.user.role}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-3.5 backdrop-blur">
          <div className="min-w-0">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav className="flex items-center gap-1.5 text-xs text-slate-400">
                {breadcrumbs.map((crumb, index) => (
                  <span key={index} className="flex items-center gap-1.5">
                    {index > 0 && <span className="text-slate-300">/</span>}
                    {crumb.to ? (
                      <Link to={crumb.to} className="transition hover:text-slate-700">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-slate-500">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {title && <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>}
            {subtitle && <p className="truncate text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>

        <main className="flex-1 px-6 py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({
  to,
  end,
  icon,
  children,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      <span className="shrink-0">{icon}</span>
      {children}
    </NavLink>
  );
}

function LogoMark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function GridIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function WorkflowsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M12 7.5v4.5M12 12l-4.5 4.5M12 12l4.5 4.5" />
    </svg>
  );
}

