import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { HealthService, HealthStatus } from './health.service';

/**
 * Thin HTTP layer for the health check; delegates all logic to HealthService.
 * Public so Docker/CI probes can reach it without credentials.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  check(): HealthStatus {
    return this.healthService.getStatus();
  }
}
