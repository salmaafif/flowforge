import { useMutation } from '@tanstack/react-query';

import { analyzeRun } from '../api/ai';
import type { FailureAnalysis } from '../api/ai';
import { ApiError } from '../api/client';

const CONFIDENCE_BADGE: Record<FailureAnalysis['confidence'], string> = {
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  high: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

/**
 * AI failure-analysis panel (requirement G). Rendered only for failed/timed-out
 * runs; on demand it calls the Groq-backed endpoint and shows the diagnosis.
 */
export function AnalysisPanel({ runId }: { runId: string }) {
  const mutation = useMutation({
    mutationFn: () => analyzeRun(runId),
  });

  const errorMessage =
    mutation.error instanceof ApiError ? mutation.error.message : 'Analysis failed, try again';

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-violet-900">✨ AI failure analysis</h2>
          <p className="text-xs text-slate-500">Diagnose why this run failed and how to fix it.</p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white
            shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending
            ? 'Analyzing…'
            : mutation.isSuccess
              ? 'Re-analyze'
              : 'Analyze failure'}
        </button>
      </div>

      {mutation.isError && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
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
        <span className="text-slate-500">Confidence:</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CONFIDENCE_BADGE[analysis.confidence]}`}
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
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-slate-700">{value}</p>
    </div>
  );
}
