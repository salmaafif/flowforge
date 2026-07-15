import { StepType, WorkflowStep } from '../dag/workflow-definition.schema';
import { StepExecutionContext, StepExecutor, StepResult } from './step-executor';

/**
 * Holds one StepExecutor per step type and dispatches a step to the right one.
 * The engine depends on this registry rather than on concrete executors, so step
 * types can be added or swapped without changing orchestration logic.
 */
export class StepExecutorRegistry {
  private readonly executors = new Map<StepType, StepExecutor>();

  register(executor: StepExecutor): this {
    this.executors.set(executor.type, executor);
    return this;
  }

  has(type: StepType): boolean {
    return this.executors.has(type);
  }

  get(type: StepType): StepExecutor {
    const executor = this.executors.get(type);
    if (!executor) {
      throw new Error(`No executor registered for step type "${type}"`);
    }
    return executor;
  }

  execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult> {
    return this.get(step.type).execute(step, context);
  }
}
