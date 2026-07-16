import { Module } from '@nestjs/common';

import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [SchedulingModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowDefinitionValidator],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
