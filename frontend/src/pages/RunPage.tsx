import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getRun, getRunLogs } from '../api/runs';
import type { ExecutionLog, LogLevel, RunStatus, RunStep, StepStatus } from '../api/types';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { DagView } from '../components/DagView';
import { RunStatusBadge } from '../components/RunStatusBadge';
import { useRunLiveUpdates } from '../hooks/useRunLiveUpdates';

const ANALYZABLE: RunStatus[] = ['FAILED', 'TIMED_OUT'];
const TERMINAL: RunStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];

const LOG_LEVEL_STYLE: Record<LogLevel, string> = {
  DEBUG: 'text-slate-500',
  INFO: 'text-sky-300',
  WARN: 'text-amber-300',
  ERROR: 'text-red-400',
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

  const logsQuery = useQuery({
    queryKey: ['run-logs', runId],
    queryFn: () => getRunLogs(runId as string),
    enabled: Boolean(runId),
  });
  const { refetch: refetchLogs } = logsQuery;

  // Logs are flushed when the run finishes, so refetch once it reaches a
  // terminal status (the live-updates hook has already refreshed the run).
  const runStatus = run?.status;
  useEffect(() => {
    if (runStatus && TERMINAL.includes(runStatus)) {
      void refetchLogs();
    }
  }, [runStatus, refetchLogs]);

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

            {ANALYZABLE.includes(run.status) && <AnalysisPanel runId={run.id} />}

            <ol className="space-y-3">
              {run.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </ol>

            <LogsPanel logs={logsQuery.data?.data ?? []} steps={run.steps} />
          </>
        )}
      </main>
    </div>
  );
}

function LogsPanel({ logs, steps }: { logs: ExecutionLog[]; steps: RunStep[] }) {
  const stepKeyById = new Map(steps.map((step) => [step.id, step.stepKey]));

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-slate-300">Execution logs</h2>
      {logs.length === 0 ? (
        <p className="text-xs text-slate-500">No logs yet — they appear once the run finishes.</p>
      ) : (
        <ol className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 font-mono text-xs">
          {logs.map((log, index) => (
            <li
              key={index}
              className="flex gap-3 border-b border-slate-900 px-4 py-1.5 last:border-b-0"
            >
              <span className="shrink-0 text-slate-600">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`w-12 shrink-0 font-semibold ${LOG_LEVEL_STYLE[log.level]}`}>
                {log.level}
              </span>
              {log.runStepId && stepKeyById.has(log.runStepId) && (
                <span className="shrink-0 text-slate-500">[{stepKeyById.get(log.runStepId)}]</span>
              )}
              <span className="text-slate-300">{log.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
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
