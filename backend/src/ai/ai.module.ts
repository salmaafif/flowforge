import { Module } from '@nestjs/common';

import { AiController } from './ai.controller';
import { FailureAnalysisService } from './failure-analysis.service';
import { GroqClient } from './groq.client';

@Module({
  controllers: [AiController],
  providers: [GroqClient, FailureAnalysisService],
})
export class AiModule {}
