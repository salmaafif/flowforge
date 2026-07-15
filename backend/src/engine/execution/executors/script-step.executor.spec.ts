import { WorkflowStep } from '../../dag/workflow-definition.schema';
import { StepAbortedError, StepExecutionError } from '../step-executor';
import { ScriptStepExecutor } from './script-step.executor';

const scriptStep = (code: string): WorkflowStep => ({
  key: 'run',
  name: 'Run script',
  type: 'SCRIPT',
  dependsOn: [],
  config: { code },
});

describe('ScriptStepExecutor', () => {
  const executor = new ScriptStepExecutor();

  it('returns the value the script returns', async () => {
    const result = await executor.execute(scriptStep('return input;'), {
      outputs: { hello: 'world' },
    });
    expect(result.output).toEqual({ hello: 'world' });
  });

  it('can compute over its input', async () => {
    const result = await executor.execute(scriptStep('return input.x + input.y;'), {
      outputs: { x: 2, y: 3 },
    });
    expect(result.output).toBe(5);
  });

  it('supports async code', async () => {
    const result = await executor.execute(scriptStep('await Promise.resolve(); return 42;'), {
      outputs: {},
    });
    expect(result.output).toBe(42);
  });

  it('surfaces a thrown error as a StepExecutionError', async () => {
    await expect(
      executor.execute(scriptStep('throw new Error("boom");'), { outputs: {} }),
    ).rejects.toBeInstanceOf(StepExecutionError);
  });

  it('kills a script that exceeds the sandbox timeout', async () => {
    const impatient = new ScriptStepExecutor(500);
    await expect(
      impatient.execute(scriptStep('while (true) {}'), { outputs: {} }),
    ).rejects.toBeInstanceOf(StepExecutionError);
  }, 10_000);

  it('rejects when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      executor.execute(scriptStep('return 1;'), { outputs: {}, signal: controller.signal }),
    ).rejects.toBeInstanceOf(StepAbortedError);
  });
});
