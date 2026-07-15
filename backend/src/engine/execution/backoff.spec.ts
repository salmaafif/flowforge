import { RetryPolicy } from '../dag/workflow-definition.schema';
import { BackoffCalculator } from './backoff';

type Backoff = RetryPolicy['backoff'];

describe('BackoffCalculator', () => {
  it('returns a constant delay for a fixed strategy', () => {
    const backoff: Backoff = { strategy: 'fixed', initialDelayMs: 200 };
    const calc = new BackoffCalculator(backoff);
    expect(calc.delayFor(0)).toBe(200);
    expect(calc.delayFor(3)).toBe(200);
  });

  it('grows geometrically for an exponential strategy', () => {
    const backoff: Backoff = { strategy: 'exponential', initialDelayMs: 100, factor: 2 };
    const calc = new BackoffCalculator(backoff);
    expect(calc.delayFor(0)).toBe(100);
    expect(calc.delayFor(1)).toBe(200);
    expect(calc.delayFor(2)).toBe(400);
    expect(calc.delayFor(3)).toBe(800);
  });

  it('defaults the factor to 2 when omitted', () => {
    const backoff: Backoff = { strategy: 'exponential', initialDelayMs: 50 };
    const calc = new BackoffCalculator(backoff);
    expect(calc.delayFor(2)).toBe(200);
  });

  it('caps the delay at maxDelayMs', () => {
    const backoff: Backoff = {
      strategy: 'exponential',
      initialDelayMs: 100,
      factor: 10,
      maxDelayMs: 500,
    };
    const calc = new BackoffCalculator(backoff);
    expect(calc.delayFor(0)).toBe(100);
    expect(calc.delayFor(1)).toBe(500);
    expect(calc.delayFor(5)).toBe(500);
  });
});
