import { Module } from '@nestjs/common';

import { RunsModule } from '../runs/runs.module';
import { WorkflowSchedulerService } from './workflow-scheduler.service';

@Module({
  imports: [RunsModule],
  providers: [WorkflowSchedulerService],
  exports: [WorkflowSchedulerService],
})
export class SchedulingModule {}
