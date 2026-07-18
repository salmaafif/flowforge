import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { getRun, getRunLogs } from '../api/runs';
import type { ExecutionLog, LogLevel, RunStatus, RunStep, StepStatus } from '../api/types';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { AppLayout } from '../components/AppLayout';
import { DagView } from '../components/DagView';
import { RunStatusBadge } from '../components/RunStatusBadge';
import { useRunLiveUpdates } from '../hooks/useRunLiveUpdates';

const ANALYZABLE: RunStatus[] = ['FAILED', 'TIMED_OUT'];
const TERMINAL: RunStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];

const STEP_DOT: Record<StepStatus, string> = {
  PENDING: 'bg-slate-300',
  RUNNING: 'bg-sky-500 animate-pulse',
  RETRYING: 'bg-violet-500 animate-pulse',
  SUCCEEDED: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  SKIPPED: 'bg-amber-500',
};

const LOG_LEVEL_STYLE: Record<LogLevel, string> = {
  DEBUG: 'text-slate-400',
  INFO: 'text-sky-600',
  WARN: 'text-amber-600',
  ERROR: 'text-red-600',
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
    <AppLayout
      title={run ? run.workflow.name : 'Run'}
      subtitle={
        run
          ? `v${run.workflowVersion.version} · run ${run.id.slice(0, 8)} · ${run.trigger}`
          : undefined
      }
      breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Run' }]}
      actions={run && <RunStatusBadge status={run.status} />}
    >
      {runQuery.isPending && <p className="text-sm text-slate-500">Loading run…</p>}
      {runQuery.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Failed to load run: {String(runQuery.error)}
        </p>
      )}

      {run && (
        <div className="space-y-8">
          <p className="text-sm text-slate-500">
            Started: {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'}
            {run.finishedAt && ` · Finished: ${new Date(run.finishedAt).toLocaleTimeString()}`}
          </p>

          <DagView
            steps={run.workflowVersion.definition.steps}
            statusByKey={Object.fromEntries(run.steps.map((step) => [step.stepKey, step.status]))}
          />

          {ANALYZABLE.includes(run.status) && <AnalysisPanel runId={run.id} />}

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Steps</h2>
            <ol className="space-y-3">
              {run.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </ol>
          </div>

          <LogsPanel logs={logsQuery.data?.data ?? []} steps={run.steps} />
        </div>
      )}
    </AppLayout>
  );
}

function StepRow({ step }: { step: RunStep }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STEP_DOT[step.status]}`} />
        <span className="font-medium text-slate-900">{step.name}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {step.type}
        </span>
        <span className="ml-auto text-sm font-medium text-slate-500">{step.status}</span>
      </div>

      <div className="mt-2 pl-5 text-xs text-slate-400">
        {step.attempts > 0 && <span className="mr-4">attempts: {step.attempts}</span>}
        {step.durationMs !== null && <span className="mr-4">{step.durationMs} ms</span>}
      </div>

      {step.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{step.error}</p>
      )}
      {step.output !== null && step.output !== undefined && (
        <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {JSON.stringify(step.output, null, 2)}
        </pre>
      )}
    </li>
  );
}

function LogsPanel({ logs, steps }: { logs: ExecutionLog[]; steps: RunStep[] }) {
  const stepKeyById = new Map(steps.map((step) => [step.id, step.stepKey]));

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Execution logs</h2>
      {logs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
          No logs yet — they appear once the run finishes.
        </p>
      ) : (
        <ol className="overflow-x-auto rounded-xl border border-slate-200 bg-white font-mono text-xs shadow-sm">
          {logs.map((log, index) => (
            <li
              key={index}
              className="flex gap-3 border-b border-slate-100 px-4 py-1.5 last:border-b-0"
            >
              <span className="shrink-0 text-slate-400">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`w-12 shrink-0 font-semibold ${LOG_LEVEL_STYLE[log.level]}`}>
                {log.level}
              </span>
              {log.runStepId && stepKeyById.has(log.runStepId) && (
                <span className="shrink-0 text-slate-400">[{stepKeyById.get(log.runStepId)}]</span>
              )}
              <span className="text-slate-700">{log.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
