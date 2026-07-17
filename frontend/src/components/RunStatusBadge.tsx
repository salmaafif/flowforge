import type { RunStatus } from '../api/types';

const BADGE_CLASSES: Record<RunStatus, string> = {
  PENDING: 'bg-slate-500/15 text-slate-300',
  RUNNING: 'bg-sky-500/15 text-sky-300 animate-pulse',
  SUCCEEDED: 'bg-emerald-500/15 text-emerald-300',
  FAILED: 'bg-red-500/15 text-red-300',
  CANCELLED: 'bg-amber-500/15 text-amber-300',
  TIMED_OUT: 'bg-amber-500/15 text-amber-300',
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_CLASSES[status]}`}>
      {status}
    </span>
  );
}
