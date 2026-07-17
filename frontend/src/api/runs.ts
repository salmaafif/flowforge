import { api } from './client';
import type { Paginated, Run, RunDetail } from './types';

export function getRun(runId: string): Promise<RunDetail> {
  return api(`/runs/${runId}`);
}

export function listWorkflowRuns(workflowId: string, page: number): Promise<Paginated<Run>> {
  return api(`/workflows/${workflowId}/runs?page=${page}&pageSize=10`);
}
