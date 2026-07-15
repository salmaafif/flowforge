import { WorkflowStep } from '../../dag/workflow-definition.schema';
import {
  StepAbortedError,
  StepExecutionContext,
  StepExecutionError,
  StepExecutor,
  StepResult,
} from '../step-executor';

/**
 * Executes a DELAY step by waiting for the configured duration. The wait is
 * cancellable: if the context's signal aborts, the timer is cleared immediately.
 */
export class DelayStepExecutor implements StepExecutor {
  readonly type = 'DELAY' as const;

  async execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult> {
    if (step.type !== 'DELAY') {
      throw new StepExecutionError(`DelayStepExecutor received a ${step.type} step`);
    }

    await this.sleep(step.config.delayMs, context.signal);
    return { output: { waitedMs: step.config.delayMs } };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
}
