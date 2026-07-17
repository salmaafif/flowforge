import { Controller, Get } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HealthStats, StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /** Global health panel numbers: active runs + 24h success/failure/duration. */
  @Get('health')
  health(@CurrentUser() user: AuthenticatedUser): Promise<HealthStats> {
    return this.statsService.health(user);
  }
}
