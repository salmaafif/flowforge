import { useAuth } from '../auth/AuthContext';
import { WorkflowList } from '../components/WorkflowList';

/** Dashboard shell: header + workflow list (live runs and health arrive next). */
export function DashboardPage() {
  const { auth, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight">
          Flow<span className="text-sky-400">Forge</span>
        </h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-400">
            {auth?.user.email}
            <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-sky-300">
              {auth?.user.role}
            </span>
          </span>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition
              hover:border-slate-500 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <WorkflowList />
      </main>
    </div>
  );
}
