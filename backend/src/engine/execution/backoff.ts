import { RetryPolicy } from '../dag/workflow-definition.schema';

type BackoffConfig = RetryPolicy['backoff'];

const DEFAULT_FACTOR = 2;

/**
 * Computes the wait time before a given retry, for either a fixed or an exponential
 * backoff. `retryIndex` is 0-based: 0 is the delay before the first retry.
 */
export class BackoffCalculator {
  constructor(private readonly config: BackoffConfig) {}

  delayFor(retryIndex: number): number {
    const { strategy, initialDelayMs, factor = DEFAULT_FACTOR, maxDelayMs } = this.config;

    const base =
      strategy === 'exponential'
        ? initialDelayMs * Math.pow(factor, Math.max(0, retryIndex))
        : initialDelayMs;

    const capped = maxDelayMs !== undefined ? Math.min(base, maxDelayMs) : base;
    return Math.max(0, Math.floor(capped));
  }
}
