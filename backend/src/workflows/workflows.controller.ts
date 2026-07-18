import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role, WorkflowVersion } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Paginated } from '../common/pagination';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateVersionDto, createVersionSchema } from './dto/create-version.dto';
import { CreateWorkflowDto, createWorkflowSchema } from './dto/create-workflow.dto';
import { ListWorkflowsQueryDto, listWorkflowsQuerySchema } from './dto/list-workflows-query.dto';
import { UpdateWorkflowDto, updateWorkflowSchema } from './dto/update-workflow.dto';
import { SafeWorkflow, WorkflowsService } from './workflows.service';

/**
 * Workflow CRUD + versioning endpoints. Reads need any authenticated user
 * (Viewer and up); writes need Editor; destructive operations need Admin.
 * Tenant scoping happens in the service using the JWT principal.
 */
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post()
  @Roles(Role.EDITOR)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createWorkflowSchema)) dto: CreateWorkflowDto,
  ): Promise<SafeWorkflow> {
    return this.workflowsService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listWorkflowsQuerySchema)) query: ListWorkflowsQueryDto,
  ): Promise<Paginated<SafeWorkflow>> {
    return this.workflowsService.findAll(user, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SafeWorkflow> {
    return this.workflowsService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.EDITOR)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) dto: UpdateWorkflowDto,
  ): Promise<SafeWorkflow> {
    return this.workflowsService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.workflowsService.remove(user, id);
  }

  @Post(':id/webhook')
  @Roles(Role.EDITOR)
  enableWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ webhookToken: string; url: string }> {
    return this.workflowsService.enableWebhook(user, id);
  }

  @Delete(':id/webhook')
  @Roles(Role.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  disableWebhook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.workflowsService.disableWebhook(user, id);
  }

  @Get(':id/versions')
  listVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Array<Omit<WorkflowVersion, 'definition'>>> {
    return this.workflowsService.listVersions(user, id);
  }

  @Get(':id/versions/:version')
  getVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<Pick<WorkflowVersion, 'version' | 'definition'>> {
    return this.workflowsService.getVersion(user, id, version);
  }

  @Post(':id/versions')
  @Roles(Role.EDITOR)
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createVersionSchema)) dto: CreateVersionDto,
  ): Promise<WorkflowVersion> {
    return this.workflowsService.createVersion(user, id, dto);
  }

  @Post(':id/versions/:version/rollback')
  @Roles(Role.EDITOR)
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<WorkflowVersion> {
    return this.workflowsService.rollback(user, id, version);
  }
}
