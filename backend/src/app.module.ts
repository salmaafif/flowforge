import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module';

/**
 * Root application module. Feature modules are composed here.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
