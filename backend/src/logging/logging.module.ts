import { Module } from '@nestjs/common';

import { ExecutionLogService } from './execution-log.service';

/** Provides the append-only execution-log writer to feature modules. */
@Module({
  providers: [ExecutionLogService],
  exports: [ExecutionLogService],
})
export class LoggingModule {}
