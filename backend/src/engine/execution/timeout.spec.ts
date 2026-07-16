import { isTimeoutAbort, withTimeout } from './timeout';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('withTimeout', () => {
  it('aborts after the timeout elapses', async () => {
    const signal = withTimeout(20);
    expect(signal.aborted).toBe(false);
    await wait(40);
    expect(signal.aborted).toBe(true);
    expect(isTimeoutAbort(signal)).toBe(true);
  });

  it('aborts when a parent signal aborts', () => {
    const parent = new AbortController();
    const signal = withTimeout(10_000, parent.signal);

    parent.abort();
    expect(signal.aborted).toBe(true);
    expect(isTimeoutAbort(signal)).toBe(false);
  });

  it('never aborts when neither a timeout nor a parent is given', async () => {
    const signal = withTimeout(undefined);
    await wait(20);
    expect(signal.aborted).toBe(false);
  });
});
