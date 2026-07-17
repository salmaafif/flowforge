import { Module } from '@nestjs/common';

import { AiController } from './ai.controller';
import { FailureAnalysisService } from './failure-analysis.service';
import { GeminiClient } from './gemini.client';

@Module({
  controllers: [AiController],
  providers: [GeminiClient, FailureAnalysisService],
})
export class AiModule {}
