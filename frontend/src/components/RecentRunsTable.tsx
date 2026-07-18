import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { listRecentRuns, type RecentRun } from '../api/runs';

function durationOf(run: RecentRun): string {
  if (!run.startedAt || !run.finishedAt) {
    return '—';
  }
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTrigger(trigger: string): string {
  return trigger.charAt(0) + trigger.slice(1).toLowerCase();
}

const STATUS_STYLES: Record<string, string> = {
  SUCCEEDED: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  RUNNING:   'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 animate-pulse',
  PENDING:   'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  FAILED:    'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  CANCELLED: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  TIMED_OUT: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
};

const STATUS_DOT: Record<string, string> = {
  SUCCEEDED: 'bg-emerald-500',
  RUNNING:   'bg-sky-500',
  PENDING:   'bg-slate-400',
  FAILED:    'bg-red-500',
  CANCELLED: 'bg-amber-500',
  TIMED_OUT: 'bg-amber-500',
};

const STATUS_LABELS: Record<string, string> = {
  SUCCEEDED: 'Completed',
  RUNNING:   'Running',
  PENDING:   'Pending',
  FAILED:    'Failed',
  CANCELLED: 'Cancelled',
  TIMED_OUT: 'Timed Out',
};

/**
 * "Recent Runs" table shown on the dashboard below the health panel.
 * Fetches the latest runs across all workflows and displays them
 * with status badges, trigger type, duration, and start time.
 */
export function RecentRunsTable() {
  const runsQuery = useQuery({
    queryKey: ['recent-runs'],
    queryFn: () => listRecentRuns(1, 6),
    refetchInterval: 10_000,
  });

  const runs = runsQuery.data?.data ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Recent Runs</h2>
        <Link
          to="#"
          className="text-sm font-medium text-indigo-600 transition hover:text-indigo-500"
        >
          View All
        </Link>
      </div>

      {/* Loading skeleton */}
      {runsQuery.isPending && (
        <div className="divide-y divide-slate-100 px-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-6 py-4">
              <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-slate-100" />
              <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-12 animate-pulse rounded bg-slate-100" />
              <div className="ml-auto h-4 w-36 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {runsQuery.isError && (
        <div className="px-6 py-4">
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            Failed to load recent runs.
          </p>
        </div>
      )}

      {/* Empty state */}
      {runsQuery.isSuccess && runs.length === 0 && (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-slate-400">
            No runs yet — trigger a workflow to see activity here.
          </p>
        </div>
      )}

      {/* Table */}
      {runsQuery.isSuccess && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Run ID
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Trigger
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Duration
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Started
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="transition-colors hover:bg-slate-50/60"
                >
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <Link
                      to={`/runs/${run.id}`}
                      className="font-mono text-sm text-slate-600 transition hover:text-indigo-600"
                    >
                      {run.id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[run.status] ?? STATUS_STYLES.PENDING}`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[run.status] ?? STATUS_DOT.PENDING}`}
                      />
                      {STATUS_LABELS[run.status] ?? run.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5 text-slate-500">
                    {formatTrigger(run.trigger)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5 font-mono text-slate-500">
                    {durationOf(run)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3.5 text-slate-400">
                    {new Date(run.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
