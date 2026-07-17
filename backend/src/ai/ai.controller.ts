import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FailureAnalysis, FailureAnalysisService } from './failure-analysis.service';

/**
 * AI endpoints. Analysis is read-only diagnostics, so any authenticated role may
 * request it; tenant scoping happens in the service.
 */
@Controller()
export class AiController {
  constructor(private readonly failureAnalysis: FailureAnalysisService) {}

  @Post('runs/:id/analysis')
  analyzeRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) runId: string,
  ): Promise<FailureAnalysis> {
    return this.failureAnalysis.analyzeRun(user, runId);
  }
}
