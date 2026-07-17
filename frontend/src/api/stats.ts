import { api } from './client';

export interface HealthStats {
  activeRuns: number;
  last24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number | null;
  };
}

export function getHealthStats(): Promise<HealthStats> {
  return api('/stats/health');
}
