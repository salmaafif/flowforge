import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root application module. Feature modules are composed here.
 */
@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
