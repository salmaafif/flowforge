import { WorkflowStep } from '../../dag/workflow-definition.schema';
import { StepExecutionError } from '../step-executor';
import { ConditionStepExecutor } from './condition-step.executor';

const conditionStep = (expression: string): WorkflowStep => ({
  key: 'check',
  name: 'Check',
  type: 'CONDITION',
  dependsOn: [],
  config: { expression },
});

describe('ConditionStepExecutor', () => {
  const executor = new ConditionStepExecutor();

  it('evaluates a truthy expression to true', async () => {
    const result = await executor.execute(conditionStep('outputs.count > 3'), {
      outputs: { count: 5 },
    });
    expect(result.output).toBe(true);
  });

  it('evaluates a falsy expression to false', async () => {
    const result = await executor.execute(conditionStep('outputs.items.length > 0'), {
      outputs: { items: [] },
    });
    expect(result.output).toBe(false);
  });

  it('coerces the result to a boolean', async () => {
    const result = await executor.execute(conditionStep('outputs.name'), {
      outputs: { name: 'flowforge' },
    });
    expect(result.output).toBe(true);
  });

  it('throws a StepExecutionError on an invalid expression', async () => {
    await expect(
      executor.execute(conditionStep('this is (not valid'), { outputs: {} }),
    ).rejects.toBeInstanceOf(StepExecutionError);
  });
});
