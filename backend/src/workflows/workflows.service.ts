import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Workflow, WorkflowVersion } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { CyclicWorkflowError } from '../engine/dag/errors';
import { InvalidWorkflowDefinitionError } from '../engine/dag/errors';
import { WorkflowDag } from '../engine/dag/workflow-dag';
import { WorkflowDefinition } from '../engine/dag/workflow-definition.schema';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVersionDto } from './dto/create-version.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';

/**
 * Tenant-scoped workflow CRUD with append-only versioning.
 *
 * Isolation: every query is filtered by the caller's tenantId; a workflow that
 * exists in another tenant is indistinguishable from one that does not exist (404),
 * so tenants cannot probe each other's data.
 *
 * Versioning: definitions are immutable. Editing publishes version N+1; rolling
 * back to version K publishes a new version whose definition copies K. History is
 * never rewritten, and runs keep pointing at the exact version they executed.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly definitionValidator: WorkflowDefinitionValidator,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateWorkflowDto): Promise<Workflow> {
    this.assertExecutable(dto.definition);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const workflow = await tx.workflow.create({
          data: {
            tenantId: user.tenantId,
            name: dto.name,
            description: dto.description,
            cronExpression: dto.cronExpression,
          },
        });
        const version = await tx.workflowVersion.create({
          data: {
            workflowId: workflow.id,
            version: 1,
            definition: dto.definition as Prisma.InputJsonValue,
            createdById: user.userId,
          },
        });
        return { ...workflow, versions: [version] };
      });
    } catch (error) {
      this.rethrow(error, dto.name);
    }
  }

  findAll(user: AuthenticatedUser): Promise<Workflow[]> {
    return this.prisma.workflow.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, version: true, createdAt: true },
        },
      },
    });
  }

  async findOne(user: AuthenticatedUser, workflowId: string): Promise<Workflow> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, tenantId: user.tenantId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    return workflow;
  }

  async update(
    user: AuthenticatedUser,
    workflowId: string,
    dto: UpdateWorkflowDto,
  ): Promise<Workflow> {
    await this.getOwnedWorkflow(user, workflowId);
    try {
      return await this.prisma.workflow.update({ where: { id: workflowId }, data: dto });
    } catch (error) {
      this.rethrow(error, dto.name ?? '');
    }
  }

  async remove(user: AuthenticatedUser, workflowId: string): Promise<void> {
    await this.getOwnedWorkflow(user, workflowId);
    // Cascades to versions, runs, and steps via the schema's referential actions.
    await this.prisma.workflow.delete({ where: { id: workflowId } });
  }

  async listVersions(
    user: AuthenticatedUser,
    workflowId: string,
  ): Promise<Array<Omit<WorkflowVersion, 'definition'>>> {
    await this.getOwnedWorkflow(user, workflowId);
    return this.prisma.workflowVersion.findMany({
      where: { workflowId },
      orderBy: { version: 'desc' },
      select: { id: true, workflowId: true, version: true, createdById: true, createdAt: true },
    });
  }

  async createVersion(
    user: AuthenticatedUser,
    workflowId: string,
    dto: CreateVersionDto,
  ): Promise<WorkflowVersion> {
    await this.getOwnedWorkflow(user, workflowId);
    this.assertExecutable(dto.definition);
    return this.appendVersion(workflowId, dto.definition as Prisma.InputJsonValue, user.userId);
  }

  /** Rollback = publish a new version whose definition copies the target version. */
  async rollback(
    user: AuthenticatedUser,
    workflowId: string,
    targetVersion: number,
  ): Promise<WorkflowVersion> {
    await this.getOwnedWorkflow(user, workflowId);

    const target = await this.prisma.workflowVersion.findUnique({
      where: { workflowId_version: { workflowId, version: targetVersion } },
    });
    if (!target) {
      throw new NotFoundException(`Version ${targetVersion} not found`);
    }

    this.assertExecutable(this.parseStoredDefinition(target.definition));
    return this.appendVersion(workflowId, target.definition as Prisma.InputJsonValue, user.userId);
  }

  private async appendVersion(
    workflowId: string,
    definition: Prisma.InputJsonValue,
    createdById: string,
  ): Promise<WorkflowVersion> {
    // The unique constraint on [workflowId, version] makes concurrent appends safe:
    // the losing writer gets a P2002 instead of silently reusing a number.
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.workflowVersion.findFirst({
        where: { workflowId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.workflowVersion.create({
        data: {
          workflowId,
          version: (latest?.version ?? 0) + 1,
          definition,
          createdById,
        },
      });
    });
  }

  private async getOwnedWorkflow(user: AuthenticatedUser, workflowId: string): Promise<Workflow> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, tenantId: user.tenantId },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    return workflow;
  }

  /** Rejects definitions whose dependency graph contains a cycle. */
  private assertExecutable(definition: WorkflowDefinition): void {
    try {
      new WorkflowDag(definition).executionLevels();
    } catch (error) {
      if (error instanceof CyclicWorkflowError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private parseStoredDefinition(stored: Prisma.JsonValue): WorkflowDefinition {
    try {
      return this.definitionValidator.validate(stored);
    } catch (error) {
      if (error instanceof InvalidWorkflowDefinitionError) {
        throw new UnprocessableEntityException({
          message: 'Stored definition is no longer valid against the current schema',
          issues: error.issues,
        });
      }
      throw error;
    }
  }

  private rethrow(error: unknown, name: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(`A workflow named "${name}" already exists in this tenant`);
    }
    throw error;
  }
}
