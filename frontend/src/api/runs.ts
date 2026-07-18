import { api } from './client';
import type { ExecutionLog, Paginated, Run, RunDetail } from './types';

export function getRun(runId: string): Promise<RunDetail> {
  return api(`/runs/${runId}`);
}

export function getRunLogs(runId: string): Promise<Paginated<ExecutionLog>> {
  return api(`/runs/${runId}/logs?pageSize=100`);
}

export function listWorkflowRuns(workflowId: string, page: number): Promise<Paginated<Run>> {
  return api(`/workflows/${workflowId}/runs?page=${page}&pageSize=10`);
}
