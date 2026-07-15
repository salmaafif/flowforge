import { WorkflowStep } from '../../dag/workflow-definition.schema';
import { sleep } from '../sleep';
import {
  StepExecutionContext,
  StepExecutionError,
  StepExecutor,
  StepResult,
} from '../step-executor';

/**
 * Executes a DELAY step by waiting for the configured duration. The wait is
 * cancellable via the shared `sleep` helper: an aborted signal clears the timer
 * and rejects immediately.
 */
export class DelayStepExecutor implements StepExecutor {
  readonly type = 'DELAY' as const;

  async execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult> {
    if (step.type !== 'DELAY') {
      throw new StepExecutionError(`DelayStepExecutor received a ${step.type} step`);
    }

    await sleep(step.config.delayMs, context.signal);
    return { output: { waitedMs: step.config.delayMs } };
  }
}
