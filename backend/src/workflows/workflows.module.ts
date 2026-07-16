import { Module } from '@nestjs/common';

import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowDefinitionValidator],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
