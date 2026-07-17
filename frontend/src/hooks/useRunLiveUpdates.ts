import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth/AuthContext';
import type { RunEvent, RunStep, RunWithSteps } from '../api/types';

/**
 * Pure reducer: folds one SSE event into the cached run so the UI re-renders with
 * the step's new status. Exported separately for unit-style reasoning/testing.
 */
export function applyRunEvent(run: RunWithSteps, event: RunEvent): RunWithSteps {
  if (event.type === 'run-started') {
    return { ...run, status: 'RUNNING' };
  }
  if (event.type === 'run-finished') {
    return { ...run, status: event.status ?? run.status, finishedAt: event.timestamp };
  }

  const updateStep = (patch: Partial<RunStep>): RunWithSteps => ({
    ...run,
    steps: run.steps.map((step) => (step.stepKey === event.stepKey ? { ...step, ...patch } : step)),
  });

  switch (event.type) {
    case 'step-started':
      return updateStep({ status: 'RUNNING', startedAt: event.timestamp });
    case 'step-succeeded':
      return updateStep({ status: 'SUCCEEDED', output: event.output, finishedAt: event.timestamp });
    case 'step-failed':
      return updateStep({
        status: 'FAILED',
        error: event.error ?? null,
        finishedAt: event.timestamp,
      });
    case 'step-skipped':
      return updateStep({ status: 'SKIPPED' });
    case 'step-aborted':
      return updateStep({ status: 'FAILED', error: 'Aborted (timeout or cancellation)' });
    case 'step-retrying':
      return updateStep({ status: 'RETRYING', attempts: event.attempt ?? 0 });
    default:
      return run;
  }
}

/**
 * Subscribes to the tenant's SSE stream and live-patches the cached run.
 *
 * EventSource keeps one HTTP connection open; the server pushes a `data:` frame
 * per event and the browser fires `onmessage` for each — reconnection is built in.
 * The JWT travels as ?access_token= because EventSource cannot set headers.
 * After run-finished we refetch once so the DB remains the source of truth
 * (attempts, durations, outputs).
 */
export function useRunLiveUpdates(runId: string | undefined): void {
  const queryClient = useQueryClient();
  const { auth } = useAuth();

  useEffect(() => {
    if (!runId || !auth) {
      return;
    }

    const source = new EventSource(`/events/runs?access_token=${auth.accessToken}`);

    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as RunEvent;
      if (event.runId !== runId) {
        return;
      }

      queryClient.setQueryData<RunWithSteps>(['run', runId], (cached) =>
        cached ? applyRunEvent(cached, event) : cached,
      );

      if (event.type === 'run-finished') {
        void queryClient.invalidateQueries({ queryKey: ['run', runId] });
      }
    };

    return () => source.close();
  }, [runId, auth, queryClient]);
}
