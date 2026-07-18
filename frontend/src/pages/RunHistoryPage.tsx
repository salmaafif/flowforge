import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { listWorkflowRuns } from '../api/runs';
import { getWorkflow } from '../api/workflows';
import type { Run } from '../api/types';
import { AppLayout } from '../components/AppLayout';
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
    <AppLayout
      title="Run history"
      subtitle={workflowQuery.data?.name}
      breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Run history' }]}
    >
      {runsQuery.isPending && <p className="text-sm text-slate-500">Loading runs…</p>}
      {runsQuery.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Failed to load runs: {String(runsQuery.error)}
        </p>
      )}

      {runsQuery.isSuccess && runs.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No runs yet — trigger the workflow to see its history here.
        </p>
      )}

      <ul className="space-y-2">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              to={`/runs/${run.id}`}
              className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3
                shadow-sm transition hover:border-slate-300 hover:shadow"
            >
              <RunStatusBadge status={run.status} />
              <span className="font-mono text-sm text-slate-500">{run.id.slice(0, 8)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {run.trigger}
              </span>
              <span className="ml-auto text-sm text-slate-400">
                {new Date(run.createdAt).toLocaleString()}
              </span>
              <span className="w-16 text-right text-sm font-medium text-slate-600">
                {durationOf(run)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {meta && meta.totalPages > 1 && (
        <div className="mt-5 flex items-center justify-end gap-3 text-sm text-slate-500">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 transition hover:bg-slate-50 disabled:opacity-40"
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
            className="rounded-lg border border-slate-300 px-3 py-1 transition hover:bg-slate-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </AppLayout>
  );
}
