import { Module } from '@nestjs/common';

import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { AiController } from './ai.controller';
import { FailureAnalysisService } from './failure-analysis.service';
import { GroqClient } from './groq.client';
import { WorkflowGeneratorService } from './workflow-generator.service';

@Module({
  controllers: [AiController],
  providers: [
    GroqClient,
    FailureAnalysisService,
    WorkflowGeneratorService,
    WorkflowDefinitionValidator,
  ],
})
export class AiModule {}
