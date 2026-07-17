import { api } from './client';
import type { Paginated, RunWithSteps, WorkflowSummary } from './types';

export interface ListWorkflowsParams {
  page: number;
  pageSize?: number;
  search?: string;
}

export function listWorkflows(params: ListWorkflowsParams): Promise<Paginated<WorkflowSummary>> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize ?? 10),
  });
  if (params.search) {
    query.set('search', params.search);
  }
  return api(`/workflows?${query.toString()}`);
}

export function getWorkflow(workflowId: string): Promise<WorkflowSummary> {
  return api(`/workflows/${workflowId}`);
}

export function triggerWorkflow(workflowId: string): Promise<RunWithSteps> {
  return api(`/workflows/${workflowId}/trigger`, { method: 'POST', body: JSON.stringify({}) });
}

export function updateWorkflow(
  workflowId: string,
  patch: { enabled?: boolean },
): Promise<WorkflowSummary> {
  return api(`/workflows/${workflowId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
