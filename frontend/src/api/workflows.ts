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

export interface CreateWorkflowPayload {
  name: string;
  description?: string;
  cronExpression?: string;
  definition: unknown;
}

export function createWorkflow(payload: CreateWorkflowPayload): Promise<WorkflowSummary> {
  return api('/workflows', { method: 'POST', body: JSON.stringify(payload) });
}

export function triggerWorkflow(workflowId: string): Promise<RunWithSteps> {
  return api(`/workflows/${workflowId}/trigger`, { method: 'POST', body: JSON.stringify({}) });
}

export interface UpdateWorkflowPatch {
  name?: string;
  description?: string | null;
  cronExpression?: string | null;
  enabled?: boolean;
}

export function updateWorkflow(
  workflowId: string,
  patch: UpdateWorkflowPatch,
): Promise<WorkflowSummary> {
  return api(`/workflows/${workflowId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export interface WorkflowVersionDefinition {
  version: number;
  definition: unknown;
}

export function getWorkflowVersion(
  workflowId: string,
  version: number,
): Promise<WorkflowVersionDefinition> {
  return api(`/workflows/${workflowId}/versions/${version}`);
}

export function createWorkflowVersion(workflowId: string, definition: unknown): Promise<unknown> {
  return api(`/workflows/${workflowId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ definition }),
  });
}

/** Natural-language workflow builder: describe it in English, get a valid DAG back. */
export function generateWorkflow(prompt: string): Promise<{ definition: unknown }> {
  return api('/workflows/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
}
