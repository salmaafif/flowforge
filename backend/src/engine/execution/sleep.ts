import { StepAbortedError } from './step-executor';

/**
 * Cancellable delay. Resolves after `ms`, or rejects with StepAbortedError as soon
 * as the optional signal aborts. Shared by the DELAY step executor and the retry
 * backoff so both honour timeouts and cancellation the same way.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StepAbortedError());
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new StepAbortedError());
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
