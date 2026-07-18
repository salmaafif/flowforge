import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const canEdit = auth?.user.role === 'ADMIN' || auth?.user.role === 'EDITOR';

  const workflowsQuery = useQuery({
    queryKey: ['workflows', { page, search }],
    queryFn: () => listWorkflows({ page, pageSize: PAGE_SIZE, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  const triggerMutation = useMutation({
    mutationFn: triggerWorkflow,
    // Jump straight into the live view so the run can be watched as it executes.
    onSuccess: (run) => navigate(`/runs/${run.id}`),
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
        <h2 className="text-base font-semibold text-slate-900">Workflows</h2>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search workflows…"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm
                text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-500
                focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          {canEdit && (
            <Link
              to="/workflows/new"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm
                font-medium text-white shadow-sm transition hover:bg-indigo-500"
            >
              <span className="text-base leading-none">+</span> New workflow
            </Link>
          )}
        </div>
      </div>

      {workflowsQuery.isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[70px] animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      )}
      {workflowsQuery.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Failed to load workflows: {String(workflowsQuery.error)}
        </p>
      )}

      {workflowsQuery.isSuccess && workflows.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No workflows found.
        </p>
      )}

      <ul className="space-y-3">
        {workflows.map((workflow) => (
          <li
            key={workflow.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-slate-200
              bg-white px-5 py-4 shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-slate-900">{workflow.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                  v{workflow.versions[0]?.version ?? '—'}
                </span>
                {workflow.cronExpression && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                    ⏱ {workflow.cronExpression}
                  </span>
                )}
                {!workflow.enabled && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    disabled
                  </span>
                )}
              </div>
              {workflow.description && (
                <p className="mt-1 truncate text-sm text-slate-500">{workflow.description}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                to={`/workflows/${workflow.id}/runs`}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600
                  transition hover:bg-slate-50 hover:text-slate-900"
              >
                History
              </Link>
              {canEdit && (
                <>
                  <Link
                    to={`/workflows/${workflow.id}/edit`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600
                      transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      toggleMutation.mutate({ id: workflow.id, enabled: !workflow.enabled })
                    }
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600
                      transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    {workflow.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={!workflow.enabled || triggerMutation.isPending}
                    onClick={() => triggerMutation.mutate(workflow.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm
                      font-medium text-white shadow-sm transition hover:bg-indigo-500
                      disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <PlayIcon />
                    Run
                  </button>
                </>
              )}
            </div>
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
    </section>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
