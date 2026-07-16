import { RetryPolicy } from '../dag/workflow-definition.schema';
import { RetryExecutor, SleepFn } from './retry-executor';
import { StepAbortedError } from './step-executor';

const policy = (maxRetries: number): RetryPolicy => ({
  maxRetries,
  backoff: { strategy: 'exponential', initialDelayMs: 100, factor: 2 },
});

describe('RetryExecutor', () => {
  // Injected sleep that records delays instead of waiting.
  const recordedDelays: number[] = [];
  const fakeSleep: SleepFn = async (ms) => {
    recordedDelays.push(ms);
  };
  const executor = new RetryExecutor(fakeSleep);

  beforeEach(() => {
    recordedDelays.length = 0;
  });

  it('returns immediately when the operation succeeds', async () => {
    const operation = jest.fn().mockResolvedValue('ok');
    await expect(executor.run(operation, policy(3))).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(recordedDelays).toEqual([]);
  });

  it('retries and eventually succeeds', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    await expect(executor.run(operation, policy(3))).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    // Delays before retry #1 and #2 (exponential: 100, 200).
    expect(recordedDelays).toEqual([100, 200]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(executor.run(operation, policy(2))).rejects.toThrow('always fails');
    // 1 initial + 2 retries = 3 attempts.
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('runs exactly once when no policy is provided', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(executor.run(operation)).rejects.toThrow('boom');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not retry an aborted step', async () => {
    const operation = jest.fn().mockRejectedValue(new StepAbortedError());
    await expect(executor.run(operation, policy(5))).rejects.toBeInstanceOf(StepAbortedError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('notifies onRetry with attempt and delay', async () => {
    const operation = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
    const onRetry = jest.fn();

    await executor.run(operation, policy(3), { onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, delayMs: 100 }));
  });

  it('stops before running when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = jest.fn().mockResolvedValue('ok');

    await expect(
      executor.run(operation, policy(3), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(StepAbortedError);
    expect(operation).not.toHaveBeenCalled();
  });
});
