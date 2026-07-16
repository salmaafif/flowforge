import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { getRun } from '../api/runs';
import type { RunStatus, RunStep, StepStatus } from '../api/types';
import { useRunLiveUpdates } from '../hooks/useRunLiveUpdates';

const RUN_BADGE: Record<RunStatus, string> = {
  PENDING: 'bg-slate-500/15 text-slate-300',
  RUNNING: 'bg-sky-500/15 text-sky-300 animate-pulse',
  SUCCEEDED: 'bg-emerald-500/15 text-emerald-300',
  FAILED: 'bg-red-500/15 text-red-300',
  CANCELLED: 'bg-amber-500/15 text-amber-300',
  TIMED_OUT: 'bg-amber-500/15 text-amber-300',
};

const STEP_DOT: Record<StepStatus, string> = {
  PENDING: 'bg-slate-600',
  RUNNING: 'bg-sky-400 animate-pulse',
  RETRYING: 'bg-violet-400 animate-pulse',
  SUCCEEDED: 'bg-emerald-400',
  FAILED: 'bg-red-400',
  SKIPPED: 'bg-amber-400',
};

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();

  const runQuery = useQuery({
    queryKey: ['run', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
  });
  useRunLiveUpdates(runId);

  const run = runQuery.data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link to="/" className="text-sm text-slate-400 transition hover:text-white">
          ← Back to workflows
        </Link>
        {run && (
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${RUN_BADGE[run.status]}`}>
            {run.status}
          </span>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {runQuery.isPending && <p className="text-slate-400">Loading run…</p>}
        {runQuery.isError && (
          <p role="alert" className="text-red-400">
            Failed to load run: {String(runQuery.error)}
          </p>
        )}

        {run && (
          <>
            <div className="mb-8">
              <h1 className="text-xl font-semibold">Run {run.id.slice(0, 8)}</h1>
              <p className="mt-1 text-sm text-slate-500">
                Trigger: {run.trigger} · Started:{' '}
                {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'}
                {run.finishedAt && ` · Finished: ${new Date(run.finishedAt).toLocaleTimeString()}`}
              </p>
            </div>

            <ol className="space-y-3">
              {run.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}

function StepRow({ step }: { step: RunStep }) {
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 shrink-0 rounded-full ${STEP_DOT[step.status]}`} />
        <span className="font-medium">{step.name}</span>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
          {step.type}
        </span>
        <span className="ml-auto text-sm text-slate-400">{step.status}</span>
      </div>

      <div className="mt-2 pl-6 text-xs text-slate-500">
        {step.attempts > 0 && <span className="mr-4">attempts: {step.attempts}</span>}
        {step.durationMs !== null && <span className="mr-4">{step.durationMs} ms</span>}
      </div>

      {step.error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 pl-6 text-xs text-red-400">
          {step.error}
        </p>
      )}
      {step.output !== null && step.output !== undefined && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-400">
          {JSON.stringify(step.output, null, 2)}
        </pre>
      )}
    </li>
  );
}
