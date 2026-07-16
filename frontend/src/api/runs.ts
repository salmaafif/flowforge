import { api } from './client';
import type { RunDetail } from './types';

export function getRun(runId: string): Promise<RunDetail> {
  return api(`/runs/${runId}`);
}
