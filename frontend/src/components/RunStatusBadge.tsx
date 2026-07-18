import type { RunStatus } from '../api/types';

const BADGE_CLASSES: Record<RunStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600 ring-slate-200',
  RUNNING: 'bg-sky-50 text-sky-700 ring-sky-200 animate-pulse',
  SUCCEEDED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  FAILED: 'bg-red-50 text-red-700 ring-red-200',
  CANCELLED: 'bg-amber-50 text-amber-700 ring-amber-200',
  TIMED_OUT: 'bg-amber-50 text-amber-700 ring-amber-200',
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${BADGE_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}
