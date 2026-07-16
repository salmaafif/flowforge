import { Module } from '@nestjs/common';

import { createDefaultStepExecutorRegistry } from '../engine/execution/default-registry';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { WorkflowEngine } from '../engine/workflow-engine';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

/**
 * Runs module: composition root where the pure engine is wired with its default
 * step executors and exposed to the HTTP layer through RunsService.
 */
@Module({
  controllers: [RunsController],
  providers: [
    RunsService,
    WorkflowDefinitionValidator,
    {
      provide: WorkflowEngine,
      useFactory: (): WorkflowEngine => new WorkflowEngine(createDefaultStepExecutorRegistry()),
    },
  ],
  exports: [RunsService],
})
export class RunsModule {}
