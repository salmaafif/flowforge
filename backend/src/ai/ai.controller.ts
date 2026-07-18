import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkflowDefinition } from '../engine/dag/workflow-definition.schema';
import { GenerateWorkflowDto, generateWorkflowSchema } from './dto/generate-workflow.dto';
import { FailureAnalysis, FailureAnalysisService } from './failure-analysis.service';
import { WorkflowGeneratorService } from './workflow-generator.service';

/**
 * AI endpoints. Analysis is read-only diagnostics (any authenticated role);
 * generation authors a definition, so it requires Editor. Tenant scoping and
 * output guards happen in the services.
 */
@Controller()
export class AiController {
  constructor(
    private readonly failureAnalysis: FailureAnalysisService,
    private readonly workflowGenerator: WorkflowGeneratorService,
  ) {}

  @Post('runs/:id/analysis')
  analyzeRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) runId: string,
  ): Promise<FailureAnalysis> {
    return this.failureAnalysis.analyzeRun(user, runId);
  }

  @Post('workflows/generate')
  @Roles(Role.EDITOR)
  generateWorkflow(
    @Body(new ZodValidationPipe(generateWorkflowSchema)) dto: GenerateWorkflowDto,
  ): Promise<{ definition: WorkflowDefinition }> {
    return this.workflowGenerator.generate(dto.prompt);
  }
}
