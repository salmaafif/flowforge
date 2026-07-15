/**
 * Builds an AbortSignal that fires when the given timeout elapses OR when any of the
 * provided parent signals abort. Used to enforce a global workflow timeout on top of
 * run cancellation: every step executor already honours the signal it is handed.
 *
 * If neither a timeout nor a parent is given, the returned signal never aborts.
 */
export function withTimeout(
  timeoutMs?: number,
  ...parents: Array<AbortSignal | undefined>
): AbortSignal {
  const signals: AbortSignal[] = [];

  if (timeoutMs !== undefined) {
    signals.push(AbortSignal.timeout(timeoutMs));
  }
  for (const parent of parents) {
    if (parent) {
      signals.push(parent);
    }
  }

  if (signals.length === 0) {
    return new AbortController().signal;
  }
  if (signals.length === 1) {
    return signals[0];
  }
  return AbortSignal.any(signals);
}

/** True when the signal aborted specifically because of a timeout (vs. cancellation). */
export function isTimeoutAbort(signal: AbortSignal): boolean {
  return (
    signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
  );
}
