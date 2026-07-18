import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { listWorkflows, triggerWorkflow, updateWorkflow } from '../api/workflows';
import type { Paginated, WorkflowSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const PAGE_SIZE = 10;

/**
 * Workflow table with server-side search + pagination. Displays workflows
 * in a proper HTML table with informative columns: name, version, status,
 * schedule, last updated, and action buttons.
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
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateWorkflow(id, { enabled }),
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
    onError: (_error, _variables, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const meta = workflowsQuery.data?.meta;
  const workflows = workflowsQuery.data?.data ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Workflows</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
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
              className="w-56 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm
                text-slate-900 placeholder-slate-400 outline-none transition
                focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          {canEdit && (
            <Link
              to="/workflows/new"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm
                font-medium text-white shadow-sm transition hover:bg-indigo-500 active:bg-indigo-700"
            >
              <PlusIcon />
              New workflow
            </Link>
          )}
        </div>
      </div>

      {/* Loading */}
      {workflowsQuery.isPending && (
        <div className="divide-y divide-slate-50 px-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-6 py-4">
              <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
              <div className="h-5 w-10 animate-pulse rounded bg-slate-100" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
              <div className="h-4 w-20 animate-pulse rounded bg-slate-100" />
              <div className="ml-auto h-4 w-36 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {workflowsQuery.isError && (
        <div className="px-6 py-4">
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            Failed to load workflows: {String(workflowsQuery.error)}
          </p>
        </div>
      )}

      {/* Empty */}
      {workflowsQuery.isSuccess && workflows.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-slate-400">No workflows found. Create one to get started.</p>
        </div>
      )}

      {/* Table */}
      {workflows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Name
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Version
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Schedule
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Updated
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {workflows.map((workflow) => (
                <tr key={workflow.id} className="group transition-colors hover:bg-slate-50/60">
                  {/* Name + description */}
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <Link
                      to={`/workflows/${workflow.id}/edit`}
                      className="font-medium text-slate-900 transition hover:text-indigo-600"
                    >
                      {workflow.name}
                    </Link>
                  </td>

                  {/* Version */}
                  <td className="whitespace-nowrap px-6 py-3.5">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500">
                      v{workflow.versions[0]?.version ?? '—'}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="whitespace-nowrap px-6 py-3.5">
                    {workflow.enabled ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Disabled
                      </span>
                    )}
                  </td>

                  {/* Schedule */}
                  <td className="whitespace-nowrap px-6 py-3.5 text-slate-500">
                    {workflow.cronExpression ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                        ⏱ {workflow.cronExpression}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Manual only</span>
                    )}
                  </td>

                  {/* Updated */}
                  <td className="whitespace-nowrap px-6 py-3.5 text-xs text-slate-400">
                    {new Date(workflow.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>

                  {/* Actions */}
                  <td className="whitespace-nowrap px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        to={`/workflows/${workflow.id}/runs`}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500
                          transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        History
                      </Link>
                      {canEdit && (
                        <>
                          <Link
                            to={`/workflows/${workflow.id}/edit`}
                            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500
                              transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              toggleMutation.mutate({ id: workflow.id, enabled: !workflow.enabled })
                            }
                            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500
                              transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            {workflow.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            disabled={!workflow.enabled || triggerMutation.isPending}
                            onClick={() => triggerMutation.mutate(workflow.id)}
                            className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5
                              text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500
                              active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <PlayIcon />
                            Run
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
          <span className="text-xs text-slate-400">
            Page {meta.page} of {meta.totalPages} · {meta.total} workflow
            {meta.total !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600
                transition hover:bg-slate-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600
                transition hover:bg-slate-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
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
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
