import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role, Run } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Paginated, PaginationQuery, paginationQuerySchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TriggerRunDto, triggerRunSchema } from './dto/trigger-run.dto';
import { ExecutionLogView, RunDetail, RunWithSteps, RunsService } from './runs.service';

/**
 * Run endpoints: manual triggering plus run history reads. Triggering answers
 * 202 Accepted immediately — execution continues in the background.
 */
@Controller()
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Post('workflows/:id/trigger')
  @Roles(Role.EDITOR)
  @HttpCode(HttpStatus.ACCEPTED)
  trigger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) workflowId: string,
    @Body(new ZodValidationPipe(triggerRunSchema)) dto: TriggerRunDto,
  ): Promise<RunWithSteps> {
    return this.runsService.trigger(user, workflowId, dto);
  }

  @Get('workflows/:id/runs')
  listForWorkflow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) workflowId: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<Run>> {
    return this.runsService.listForWorkflow(user, workflowId, query);
  }

  @Get('runs/:id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) runId: string,
  ): Promise<RunDetail> {
    return this.runsService.findOne(user, runId);
  }

  @Get('runs/:id/logs')
  listLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) runId: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<ExecutionLogView>> {
    return this.runsService.listLogs(user, runId, query);
  }
}
