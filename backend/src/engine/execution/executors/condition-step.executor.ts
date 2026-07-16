import { WorkflowStep } from '../../dag/workflow-definition.schema';
import {
  StepExecutionContext,
  StepExecutionError,
  StepExecutor,
  StepResult,
} from '../step-executor';

/**
 * Evaluates a CONDITION step's boolean expression.
 *
 * The expression is authored by a tenant user (Editor/Admin) as part of the
 * workflow definition, so — like SCRIPT steps — it is treated under a "trusted
 * within the tenant" model, the same posture GitHub Actions takes toward the
 * scripts in a repo's own workflows. The expression is evaluated with only the
 * upstream step `outputs` in scope and no arguments beyond it.
 */
export class ConditionStepExecutor implements StepExecutor {
  readonly type = 'CONDITION' as const;

  async execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult> {
    if (step.type !== 'CONDITION') {
      throw new StepExecutionError(`ConditionStepExecutor received a ${step.type} step`);
    }

    const result = this.evaluate(step.config.expression, context.outputs);
    return { output: result };
  }

  private evaluate(expression: string, outputs: Readonly<Record<string, unknown>>): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const evaluator = new Function('outputs', `"use strict"; return (${expression});`) as (
        outputs: Readonly<Record<string, unknown>>,
      ) => unknown;
      return Boolean(evaluator(outputs));
    } catch (error) {
      throw new StepExecutionError(`Failed to evaluate condition expression: ${expression}`, {
        cause: error,
      });
    }
  }
}
