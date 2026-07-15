import { Controller, Get } from '@nestjs/common';

import { HealthService, HealthStatus } from './health.service';

/**
 * Thin HTTP layer for the health check; delegates all logic to HealthService.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): HealthStatus {
    return this.healthService.getStatus();
  }
}
