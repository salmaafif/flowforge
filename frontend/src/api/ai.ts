import { api } from './client';

export interface FailureAnalysis {
  summary: string;
  rootCause: string;
  suggestedFix: string;
  confidence: 'low' | 'medium' | 'high';
}

export function analyzeRun(runId: string): Promise<FailureAnalysis> {
  return api(`/runs/${runId}/analysis`, { method: 'POST', body: JSON.stringify({}) });
}
