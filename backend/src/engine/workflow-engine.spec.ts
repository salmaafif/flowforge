import { CyclicWorkflowError, WorkflowDefinition, WorkflowDefinitionValidator } from './dag';
import { createDefaultStepExecutorRegistry } from './execution';
import { StepEvent, WorkflowEngine } from './workflow-engine';

const validator = new WorkflowDefinitionValidator();
const validate = (definition: unknown): WorkflowDefinition => validator.validate(definition);

const engine = new WorkflowEngine(createDefaultStepExecutorRegistry());

const statusByKey = (result: { steps: Array<{ key: string; status: string }> }) =>
  Object.fromEntries(result.steps.map((step) => [step.key, step.status]));

describe('WorkflowEngine (in-memory end-to-end)', () => {
  it('runs a linear workflow to completion and flows data between steps', async () => {
    const definition = validate({
      steps: [
        { key: 'a', name: 'Seed', type: 'SCRIPT', config: { code: 'return 1;' } },
        {
          key: 'b',
          name: 'Increment',
          type: 'SCRIPT',
          dependsOn: ['a'],
          config: { code: 'return input.a + 1;' },
        },
        { key: 'c', name: 'Cooldown', type: 'DELAY', dependsOn: ['b'], config: { delayMs: 5 } },
      ],
    });

    const result = await engine.execute(definition);

    expect(result.status).toBe('SUCCEEDED');
    expect(statusByKey(result)).toEqual({ a: 'SUCCEEDED', b: 'SUCCEEDED', c: 'SUCCEEDED' });
    expect(result.outputs.a).toBe(1);
    expect(result.outputs.b).toBe(2);
  }, 15_000);

  it('runs independent steps in parallel', async () => {
    const definition = validate({
      steps: [
        { key: 'left', name: 'Left', type: 'DELAY', config: { delayMs: 150 } },
        { key: 'right', name: 'Right', type: 'DELAY', config: { delayMs: 150 } },
      ],
    });

    const result = await engine.execute(definition);

    expect(result.status).toBe('SUCCEEDED');
    // Parallel execution: total wall-clock is close to one delay, not the sum.
    expect(result.durationMs).toBeLessThan(280);
  }, 15_000);

  it('skips the downstream path when a condition is false', async () => {
    const definition = validate({
      steps: [
        { key: 'a', name: 'Seed', type: 'SCRIPT', config: { code: 'return 5;' } },
        {
          key: 'gate',
          name: 'Gate',
          type: 'CONDITION',
          dependsOn: ['a'],
          config: { expression: 'outputs.a > 10' },
        },
        { key: 'after', name: 'After', type: 'DELAY', dependsOn: ['gate'], config: { delayMs: 5 } },
      ],
    });

    const result = await engine.execute(definition);

    expect(result.status).toBe('SUCCEEDED');
    expect(statusByKey(result)).toEqual({ a: 'SUCCEEDED', gate: 'SUCCEEDED', after: 'SKIPPED' });
  }, 15_000);

  it('fails the run and skips dependents when a step keeps erroring', async () => {
    const definition = validate({
      steps: [
        {
          key: 'bad',
          name: 'Always fails',
          type: 'SCRIPT',
          config: { code: 'throw new Error("boom");' },
          retry: { maxRetries: 2, backoff: { strategy: 'fixed', initialDelayMs: 1 } },
        },
        { key: 'next', name: 'Next', type: 'DELAY', dependsOn: ['bad'], config: { delayMs: 5 } },
      ],
    });

    const result = await engine.execute(definition);

    expect(result.status).toBe('FAILED');
    const bad = result.steps.find((step) => step.key === 'bad');
    expect(bad?.status).toBe('FAILED');
    expect(bad?.attempts).toBe(3); // 1 initial + 2 retries
    expect(statusByKey(result).next).toBe('SKIPPED');
  }, 20_000);

  it('times out a long-running workflow', async () => {
    const definition = validate({
      steps: [{ key: 'slow', name: 'Slow', type: 'DELAY', config: { delayMs: 5000 } }],
    });

    const result = await engine.execute(definition, { timeoutMs: 50 });

    expect(result.status).toBe('TIMED_OUT');
    expect(result.steps[0].status).toBe('ABORTED');
  }, 15_000);

  it('emits step lifecycle events', async () => {
    const definition = validate({
      steps: [{ key: 'a', name: 'A', type: 'DELAY', config: { delayMs: 5 } }],
    });
    const events: StepEvent[] = [];

    await engine.execute(definition, { listener: { onStepEvent: (event) => events.push(event) } });

    expect(events.map((event) => event.type)).toEqual(['step-started', 'step-succeeded']);
  }, 15_000);

  it('rejects a cyclic definition', async () => {
    const definition = validate({
      steps: [
        { key: 'a', name: 'A', type: 'DELAY', dependsOn: ['b'], config: { delayMs: 5 } },
        { key: 'b', name: 'B', type: 'DELAY', dependsOn: ['a'], config: { delayMs: 5 } },
      ],
    });

    await expect(engine.execute(definition)).rejects.toBeInstanceOf(CyclicWorkflowError);
  });
});
