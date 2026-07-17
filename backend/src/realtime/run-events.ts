/**
 * Realtime event published while a run executes. One flat shape for every event
 * type keeps the SSE payload trivial for clients to consume.
 */
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
  /** Final run status — only on run-finished. */
  status?: string;
  error?: string;
  attempt?: number;
  delayMs?: number;
  output?: unknown;
  timestamp: string;
}
