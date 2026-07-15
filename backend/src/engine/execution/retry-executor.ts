import { RetryPolicy } from '../dag/workflow-definition.schema';
import { BackoffCalculator } from './backoff';
import { sleep as defaultSleep } from './sleep';
import { StepAbortedError } from './step-executor';

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RetryNotification {
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  error: unknown;
  /** Delay before the upcoming retry. */
  delayMs: number;
}

export interface RetryRunOptions {
  signal?: AbortSignal;
  onRetry?: (info: RetryNotification) => void;
}

/**
 * Runs an operation with configurable retries and backoff.
 *
 * Total attempts = maxRetries + 1. Aborts (StepAbortedError) are terminal and never
 * retried, so a global workflow timeout stops retrying immediately. The sleep is
 * injectable so tests can run without real delays.
 */
export class RetryExecutor {
  constructor(private readonly sleep: SleepFn = defaultSleep) {}

  async run<T>(
    operation: (attempt: number) => Promise<T>,
    policy?: RetryPolicy,
    options: RetryRunOptions = {},
  ): Promise<T> {
    const maxRetries = policy?.maxRetries ?? 0;
    const backoff = policy ? new BackoffCalculator(policy.backoff) : undefined;

    let attempt = 0;
    // Loop exits by returning the result or throwing the final error.
    for (;;) {
      attempt += 1;

      if (options.signal?.aborted) {
        throw new StepAbortedError();
      }

      try {
        return await operation(attempt);
      } catch (error) {
        if (error instanceof StepAbortedError || attempt > maxRetries) {
          throw error;
        }

        const delayMs = backoff ? backoff.delayFor(attempt - 1) : 0;
        options.onRetry?.({ attempt, error, delayMs });
        await this.sleep(delayMs, options.signal);
      }
    }
  }
}
