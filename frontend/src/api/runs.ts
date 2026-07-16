import { api } from './client';
import type { RunWithSteps } from './types';

export function getRun(runId: string): Promise<RunWithSteps> {
  return api(`/runs/${runId}`);
}
