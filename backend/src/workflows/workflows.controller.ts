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
} from '@nestjs/common';
import { Role, Workflow, WorkflowVersion } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateVersionDto, createVersionSchema } from './dto/create-version.dto';
import { CreateWorkflowDto, createWorkflowSchema } from './dto/create-workflow.dto';
import { UpdateWorkflowDto, updateWorkflowSchema } from './dto/update-workflow.dto';
import { WorkflowsService } from './workflows.service';

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
  ): Promise<Workflow> {
    return this.workflowsService.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Workflow[]> {
    return this.workflowsService.findAll(user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workflow> {
    return this.workflowsService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.EDITOR)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) dto: UpdateWorkflowDto,
  ): Promise<Workflow> {
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

  @Get(':id/versions')
  listVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Array<Omit<WorkflowVersion, 'definition'>>> {
    return this.workflowsService.listVersions(user, id);
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
