import { WorkflowDag } from './dag/workflow-dag';
import { StepType, WorkflowDefinition } from './dag/workflow-definition.schema';
import { RetryExecutor } from './execution/retry-executor';
import { StepExecutorRegistry } from './execution/step-executor.registry';
import { StepAbortedError, StepExecutionContext } from './execution/step-executor';
import { isTimeoutAbort, withTimeout } from './execution/timeout';

export type StepOutcome = 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'ABORTED';
export type WorkflowRunStatus = 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';

export interface StepRunResult {
  key: string;
  type: StepType;
  status: StepOutcome;
  attempts: number;
  output?: unknown;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
}

export interface WorkflowRunResult {
  status: WorkflowRunStatus;
  /** Step results in topological execution order. */
  steps: StepRunResult[];
  /** Outputs of the steps that succeeded, keyed by step key. */
  outputs: Record<string, unknown>;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

/** Real-time hook: the engine emits one event per step transition. */
export type StepEvent =
  | { type: 'step-started'; key: string }
  | { type: 'step-succeeded'; key: string; output: unknown }
  | { type: 'step-failed'; key: string; error: string }
  | { type: 'step-skipped'; key: string }
  | { type: 'step-aborted'; key: string }
  | { type: 'step-retrying'; key: string; attempt: number; delayMs: number };

export interface WorkflowEngineListener {
  onStepEvent?(event: StepEvent): void;
}

export interface WorkflowRunOptions {
  /** Trigger payload, exposed to steps as `outputs.$input`. */
  input?: unknown;
  /** Overrides the definition's global timeout. */
  timeoutMs?: number;
  /** External cancellation signal. */
  signal?: AbortSignal;
  listener?: WorkflowEngineListener;
}

const INPUT_KEY = '$input';

/**
 * Orchestrates a full workflow run: topologically sorts the DAG, executes each level
 * in parallel, wraps every step in retry + backoff, and enforces a global timeout.
 *
 * The engine is pure and storage-agnostic — it returns a plain result and emits
 * events. Persistence (run records, logs) and transport (SSE) are layered on top by
 * subscribing to the listener, so the core stays unit-testable without a database.
 */
export class WorkflowEngine {
  constructor(
    private readonly registry: StepExecutorRegistry,
    private readonly retryExecutor: RetryExecutor = new RetryExecutor(),
  ) {}

  async execute(
    definition: WorkflowDefinition,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRunResult> {
    const dag = new WorkflowDag(definition);
    const levels = dag.executionLevels(); // throws CyclicWorkflowError on a cycle

    const signal = withTimeout(options.timeoutMs ?? definition.timeoutMs, options.signal);
    const results = new Map<string, StepRunResult>();
    const accumulated: Record<string, unknown> =
      options.input !== undefined ? { [INPUT_KEY]: options.input } : {};

    const startedAt = Date.now();

    for (const level of levels) {
      await Promise.all(
        level.map((key) => this.runStep(dag, key, results, accumulated, signal, options.listener)),
      );
    }

    const orderedKeys = levels.flat();
    const steps = orderedKeys.map((key) => results.get(key) as StepRunResult);
    const finishedAt = Date.now();

    return {
      status: this.deriveRunStatus(steps, signal),
      steps,
      outputs: this.collectOutputs(steps),
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
    };
  }

  private async runStep(
    dag: WorkflowDag,
    key: string,
    results: Map<string, StepRunResult>,
    accumulated: Record<string, unknown>,
    signal: AbortSignal,
    listener?: WorkflowEngineListener,
  ): Promise<void> {
    const step = dag.getStep(key);
    if (!step) {
      return;
    }
    const dependencies = dag.dependenciesOf(key);

    if (!this.dependenciesAllow(dependencies, results)) {
      results.set(key, { key, type: step.type, status: 'SKIPPED', attempts: 0 });
      listener?.onStepEvent?.({ type: 'step-skipped', key });
      return;
    }

    if (signal.aborted) {
      results.set(key, { key, type: step.type, status: 'ABORTED', attempts: 0 });
      listener?.onStepEvent?.({ type: 'step-aborted', key });
      return;
    }

    const context: StepExecutionContext = { outputs: { ...accumulated }, signal };
    const startedAt = Date.now();
    let attempts = 0;

    listener?.onStepEvent?.({ type: 'step-started', key });

    try {
      const result = await this.retryExecutor.run(
        (attempt) => {
          attempts = attempt;
          return this.registry.execute(step, context);
        },
        step.retry,
        {
          signal,
          onRetry: (info) =>
            listener?.onStepEvent?.({
              type: 'step-retrying',
              key,
              attempt: info.attempt,
              delayMs: info.delayMs,
            }),
        },
      );

      const finishedAt = Date.now();
      accumulated[key] = result.output;
      results.set(key, {
        key,
        type: step.type,
        status: 'SUCCEEDED',
        attempts,
        output: result.output,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
      });
      listener?.onStepEvent?.({ type: 'step-succeeded', key, output: result.output });
    } catch (error) {
      const finishedAt = Date.now();
      const aborted = error instanceof StepAbortedError;
      const message = error instanceof Error ? error.message : String(error);
      results.set(key, {
        key,
        type: step.type,
        status: aborted ? 'ABORTED' : 'FAILED',
        attempts: Math.max(attempts, 1),
        error: message,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
      });
      listener?.onStepEvent?.(
        aborted ? { type: 'step-aborted', key } : { type: 'step-failed', key, error: message },
      );
    }
  }

  /**
   * A step runs only if every dependency succeeded, and any CONDITION dependency
   * evaluated to true. Otherwise the step is skipped — this is how conditional
   * branches prune their downstream path.
   */
  private dependenciesAllow(dependencies: string[], results: Map<string, StepRunResult>): boolean {
    return dependencies.every((depKey) => {
      const dependency = results.get(depKey);
      if (!dependency || dependency.status !== 'SUCCEEDED') {
        return false;
      }
      if (dependency.type === 'CONDITION' && dependency.output === false) {
        return false;
      }
      return true;
    });
  }

  private deriveRunStatus(steps: StepRunResult[], signal: AbortSignal): WorkflowRunStatus {
    const aborted = signal.aborted || steps.some((step) => step.status === 'ABORTED');
    if (aborted) {
      return isTimeoutAbort(signal) ? 'TIMED_OUT' : 'CANCELLED';
    }
    if (steps.some((step) => step.status === 'FAILED')) {
      return 'FAILED';
    }
    return 'SUCCEEDED';
  }

  private collectOutputs(steps: StepRunResult[]): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const step of steps) {
      if (step.status === 'SUCCEEDED') {
        outputs[step.key] = step.output;
      }
    }
    return outputs;
  }
}
