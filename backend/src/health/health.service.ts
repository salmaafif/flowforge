import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
}

/**
 * Encapsulates the logic behind the health check so the controller stays thin.
 */
@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
