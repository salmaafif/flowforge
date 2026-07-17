import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { listWorkflowRuns } from '../api/runs';
import { getWorkflow } from '../api/workflows';
import type { Run } from '../api/types';
import { RunStatusBadge } from '../components/RunStatusBadge';

function durationOf(run: Run): string {
  if (!run.startedAt || !run.finishedAt) {
    return '—';
  }
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Paginated run history of one workflow; every row links to the live run view. */
export function RunHistoryPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [page, setPage] = useState(1);

  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => getWorkflow(workflowId as string),
    enabled: Boolean(workflowId),
  });

  const runsQuery = useQuery({
    queryKey: ['workflow-runs', workflowId, page],
    queryFn: () => listWorkflowRuns(workflowId as string, page),
    enabled: Boolean(workflowId),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

  const runs = runsQuery.data?.data ?? [];
  const meta = runsQuery.data?.meta;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link to="/" className="text-sm text-slate-400 transition hover:text-white">
          ← Back to workflows
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-6 text-xl font-semibold">
          Run history
          {workflowQuery.data && (
            <span className="ml-2 text-slate-400">· {workflowQuery.data.name}</span>
          )}
        </h1>

        {runsQuery.isPending && <p className="text-slate-400">Loading runs…</p>}
        {runsQuery.isError && (
          <p role="alert" className="text-red-400">
            Failed to load runs: {String(runsQuery.error)}
          </p>
        )}

        {runsQuery.isSuccess && runs.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-500">
            No runs yet — trigger the workflow to see its history here.
          </p>
        )}

        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                to={`/runs/${run.id}`}
                className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/50
                  px-5 py-3 transition hover:border-slate-600"
              >
                <RunStatusBadge status={run.status} />
                <span className="font-mono text-sm text-slate-300">{run.id.slice(0, 8)}</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {run.trigger}
                </span>
                <span className="ml-auto text-sm text-slate-500">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
                <span className="w-16 text-right text-sm text-slate-400">{durationOf(run)}</span>
              </Link>
            </li>
          ))}
        </ul>

        {meta && meta.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-3 text-sm text-slate-400">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>
              Page {meta.page} / {meta.totalPages}
            </span>
            <button
              type="button"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-lg border border-slate-700 px-3 py-1 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
