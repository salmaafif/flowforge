import { StepType, WorkflowStep } from '../dag/workflow-definition.schema';

/**
 * Everything a step needs to run: the outputs produced by the steps it depends on,
 * and an optional abort signal used to enforce timeouts and cancellation.
 */
export interface StepExecutionContext {
  /** Outputs of already-completed steps, keyed by step key. */
  readonly outputs: Readonly<Record<string, unknown>>;
  /** Aborts the step (global workflow timeout / run cancellation). */
  readonly signal?: AbortSignal;
}

export interface StepResult {
  readonly output: unknown;
}

/**
 * Strategy interface: one implementation per step type. The engine looks the right
 * executor up in the registry and delegates to it, so adding a new step type never
 * touches the orchestration code (open/closed principle).
 */
export interface StepExecutor {
  readonly type: StepType;
  execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult>;
}

/** Raised when a step fails; carries the original error as `cause` when available. */
export class StepExecutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'StepExecutionError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Raised when a step is aborted via its AbortSignal. */
export class StepAbortedError extends StepExecutionError {
  constructor(message = 'Step execution was aborted') {
    super(message);
    this.name = 'StepAbortedError';
  }
}
