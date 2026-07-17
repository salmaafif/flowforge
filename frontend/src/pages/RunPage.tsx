import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { getRun } from '../api/runs';
import type { RunStep, StepStatus } from '../api/types';
import { DagView } from '../components/DagView';
import { RunStatusBadge } from '../components/RunStatusBadge';
import { useRunLiveUpdates } from '../hooks/useRunLiveUpdates';

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
        {run && <RunStatusBadge status={run.status} />}
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
            <div className="mb-6">
              <h1 className="text-xl font-semibold">
                {run.workflow.name}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  v{run.workflowVersion.version} · run {run.id.slice(0, 8)}
                </span>
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Trigger: {run.trigger} · Started:{' '}
                {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'}
                {run.finishedAt && ` · Finished: ${new Date(run.finishedAt).toLocaleTimeString()}`}
              </p>
            </div>

            <div className="mb-8">
              <DagView
                steps={run.workflowVersion.definition.steps}
                statusByKey={Object.fromEntries(
                  run.steps.map((step) => [step.stepKey, step.status]),
                )}
              />
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
