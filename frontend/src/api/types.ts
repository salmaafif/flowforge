/** Mirrors the backend's response shapes (see backend/src/workflows & runs). */

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  createdAt: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  cronExpression: string | null;
  createdAt: string;
  updatedAt: string;
  versions: WorkflowVersionSummary[];
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

export type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'RETRYING';

export interface RunStep {
  id: string;
  stepKey: string;
  name: string;
  type: 'HTTP' | 'SCRIPT' | 'DELAY' | 'CONDITION';
  status: StepStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: unknown;
  error: string | null;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: RunStatus;
  trigger: 'MANUAL' | 'SCHEDULED' | 'WEBHOOK';
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface RunWithSteps extends Run {
  steps: RunStep[];
}

/** Mirrors backend/src/realtime/run-events.ts — one flat shape for every event. */
export interface RunEvent {
  type:
    | 'run-started'
    | 'run-finished'
    | 'step-started'
    | 'step-succeeded'
    | 'step-failed'
    | 'step-skipped'
    | 'step-aborted'
    | 'step-retrying';
  tenantId: string;
  workflowId: string;
  runId: string;
  stepKey?: string;
  status?: RunStatus;
  error?: string;
  attempt?: number;
  delayMs?: number;
  output?: unknown;
  timestamp: string;
}
