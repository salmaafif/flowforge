import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { listWorkflows, triggerWorkflow, updateWorkflow } from '../api/workflows';
import type { Paginated, WorkflowSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const PAGE_SIZE = 10;

/**
 * Workflow list with server-side search + pagination. TanStack Query provides the
 * client-side cache (previous pages stay warm); the enabled-toggle is applied
 * optimistically and rolled back if the server rejects it.
 */
export function WorkflowList() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [lastRun, setLastRun] = useState<{ workflowId: string; runId: string } | null>(null);

  const canEdit = auth?.user.role === 'ADMIN' || auth?.user.role === 'EDITOR';

  const workflowsQuery = useQuery({
    queryKey: ['workflows', { page, search }],
    queryFn: () => listWorkflows({ page, pageSize: PAGE_SIZE, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  const triggerMutation = useMutation({
    mutationFn: triggerWorkflow,
    onSuccess: (run) => setLastRun({ workflowId: run.workflowId, runId: run.id }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateWorkflow(id, { enabled }),
    // Optimistic update: flip the switch in the cache immediately…
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['workflows'] });
      const snapshots = queryClient.getQueriesData<Paginated<WorkflowSummary>>({
        queryKey: ['workflows'],
      });
      queryClient.setQueriesData<Paginated<WorkflowSummary>>({ queryKey: ['workflows'] }, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((workflow) =>
                workflow.id === id ? { ...workflow, enabled } : workflow,
              ),
            }
          : old,
      );
      return { snapshots };
    },
    // …and roll back to the snapshot if the server says no.
    onError: (_error, _variables, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const meta = workflowsQuery.data?.meta;
  const workflows = workflowsQuery.data?.data ?? [];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Workflows</h2>
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search workflows…"
          className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm
            text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
        />
      </div>

      {workflowsQuery.isPending && <p className="text-slate-400">Loading workflows…</p>}
      {workflowsQuery.isError && (
        <p role="alert" className="text-red-400">
          Failed to load workflows: {String(workflowsQuery.error)}
        </p>
      )}

      {workflowsQuery.isSuccess && workflows.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-500">
          No workflows found.
        </p>
      )}

      <ul className="space-y-3">
        {workflows.map((workflow) => (
          <li
            key={workflow.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-slate-800
              bg-slate-900/50 px-5 py-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-slate-100">{workflow.name}</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  v{workflow.versions[0]?.version ?? '—'}
                </span>
                {workflow.cronExpression && (
                  <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-300">
                    ⏱ {workflow.cronExpression}
                  </span>
                )}
                {!workflow.enabled && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                    disabled
                  </span>
                )}
              </div>
              {workflow.description && (
                <p className="mt-1 truncate text-sm text-slate-500">{workflow.description}</p>
              )}
              {lastRun?.workflowId === workflow.id && (
                <p className="mt-1 text-xs text-emerald-400">
                  Run started: {lastRun.runId.slice(0, 8)}…
                </p>
              )}
            </div>

            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    toggleMutation.mutate({ id: workflow.id, enabled: !workflow.enabled })
                  }
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300
                    transition hover:border-slate-500 hover:text-white"
                >
                  {workflow.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  disabled={!workflow.enabled || triggerMutation.isPending}
                  onClick={() => triggerMutation.mutate(workflow.id)}
                  className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white
                    transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ▶ Run
                </button>
              </div>
            )}
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
    </section>
  );
}
