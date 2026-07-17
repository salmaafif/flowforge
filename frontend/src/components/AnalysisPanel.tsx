import { useMutation } from '@tanstack/react-query';

import { analyzeRun } from '../api/ai';
import type { FailureAnalysis } from '../api/ai';
import { ApiError } from '../api/client';

const CONFIDENCE_BADGE: Record<FailureAnalysis['confidence'], string> = {
  low: 'bg-slate-500/15 text-slate-300',
  medium: 'bg-amber-500/15 text-amber-300',
  high: 'bg-emerald-500/15 text-emerald-300',
};

/**
 * AI failure-analysis panel (requirement G). Rendered only for failed/timed-out
 * runs; on demand it calls the Gemini-backed endpoint and shows the diagnosis.
 */
export function AnalysisPanel({ runId }: { runId: string }) {
  const mutation = useMutation({
    mutationFn: () => analyzeRun(runId),
  });

  const errorMessage =
    mutation.error instanceof ApiError ? mutation.error.message : 'Analysis failed, try again';

  return (
    <section className="mb-8 rounded-xl border border-violet-500/30 bg-violet-500/5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-violet-200">✨ AI failure analysis</h2>
          <p className="text-xs text-slate-400">Diagnose why this run failed and how to fix it.</p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="shrink-0 rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-medium text-white
            transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending
            ? 'Analyzing…'
            : mutation.isSuccess
              ? 'Re-analyze'
              : 'Analyze failure'}
        </button>
      </div>

      {mutation.isError && (
        <p role="alert" className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      {mutation.isSuccess && <AnalysisResult analysis={mutation.data} />}
    </section>
  );
}

function AnalysisResult({ analysis }: { analysis: FailureAnalysis }) {
  return (
    <div className="mt-4 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-slate-400">Confidence:</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_BADGE[analysis.confidence]}`}
        >
          {analysis.confidence}
        </span>
      </div>
      <Field label="Summary" value={analysis.summary} />
      <Field label="Root cause" value={analysis.rootCause} />
      <Field label="Suggested fix" value={analysis.suggestedFix} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-200">{value}</p>
    </div>
  );
}
