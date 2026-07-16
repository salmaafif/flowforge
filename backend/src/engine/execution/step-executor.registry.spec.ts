import { WorkflowStep } from '../dag/workflow-definition.schema';
import { DelayStepExecutor } from './executors/delay-step.executor';
import { StepExecutorRegistry } from './step-executor.registry';

const delayStep: WorkflowStep = {
  key: 'wait',
  name: 'Wait',
  type: 'DELAY',
  dependsOn: [],
  config: { delayMs: 5 },
};

describe('StepExecutorRegistry', () => {
  it('registers and dispatches to the matching executor', async () => {
    const registry = new StepExecutorRegistry().register(new DelayStepExecutor());

    expect(registry.has('DELAY')).toBe(true);
    const result = await registry.execute(delayStep, { outputs: {} });
    expect(result.output).toEqual({ waitedMs: 5 });
  });

  it('supports a fluent chain of registrations', () => {
    const registry = new StepExecutorRegistry().register(new DelayStepExecutor());
    expect(registry.get('DELAY')).toBeInstanceOf(DelayStepExecutor);
  });

  it('throws when no executor is registered for a step type', () => {
    const registry = new StepExecutorRegistry();
    expect(() => registry.get('HTTP')).toThrow(/No executor registered/);
  });
});
