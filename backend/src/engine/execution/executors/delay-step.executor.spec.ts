import { WorkflowStep } from '../../dag/workflow-definition.schema';
import { StepAbortedError } from '../step-executor';
import { DelayStepExecutor } from './delay-step.executor';

const delayStep = (delayMs: number): WorkflowStep => ({
  key: 'wait',
  name: 'Wait',
  type: 'DELAY',
  dependsOn: [],
  config: { delayMs },
});

describe('DelayStepExecutor', () => {
  const executor = new DelayStepExecutor();

  it('resolves after the configured delay', async () => {
    const result = await executor.execute(delayStep(10), { outputs: {} });
    expect(result.output).toEqual({ waitedMs: 10 });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.execute(delayStep(1000), { outputs: {}, signal: controller.signal }),
    ).rejects.toBeInstanceOf(StepAbortedError);
  });

  it('rejects when the signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const promise = executor.execute(delayStep(1000), {
      outputs: {},
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(StepAbortedError);
  });
});
