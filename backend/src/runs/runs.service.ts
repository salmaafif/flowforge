import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Run, RunStatus, StepStatus, StepType, TriggerType } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { Paginated, PaginationQuery, paginate, toSkipTake } from '../common/pagination';
import { InvalidWorkflowDefinitionError } from '../engine/dag/errors';
import { WorkflowDefinition } from '../engine/dag/workflow-definition.schema';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import {
  StepOutcome,
  WorkflowEngine,
  WorkflowRunResult,
  WorkflowRunStatus,
} from '../engine/workflow-engine';
import { PrismaService } from '../prisma/prisma.service';
import { TriggerRunDto } from './dto/trigger-run.dto';

export type RunWithSteps = Prisma.RunGetPayload<{ include: { steps: true } }>;

const RUN_STATUS_MAP: Record<WorkflowRunStatus, RunStatus> = {
  SUCCEEDED: RunStatus.SUCCEEDED,
  FAILED: RunStatus.FAILED,
  TIMED_OUT: RunStatus.TIMED_OUT,
  CANCELLED: RunStatus.CANCELLED,
};

// The engine's ABORTED (timeout/cancellation) is recorded as FAILED on the step.
const STEP_STATUS_MAP: Record<StepOutcome, StepStatus> = {
  SUCCEEDED: StepStatus.SUCCEEDED,
  FAILED: StepStatus.FAILED,
  SKIPPED: StepStatus.SKIPPED,
  ABORTED: StepStatus.FAILED,
};

/**
 * Bridges the pure WorkflowEngine and the database.
 *
 * Triggering creates the Run (RUNNING) and its RunSteps (PENDING) synchronously and
 * responds immediately; the engine then executes in the background and the final
 * result is reconciled into the run/step records in one transaction. Clients follow
 * progress by reading the run (and, in the realtime step, via SSE).
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngine,
    private readonly definitionValidator: WorkflowDefinitionValidator,
  ) {}

  async trigger(
    user: AuthenticatedUser,
    workflowId: string,
    dto: TriggerRunDto,
  ): Promise<RunWithSteps> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, tenantId: user.tenantId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    if (!workflow.enabled) {
      throw new ConflictException('Workflow is disabled');
    }
    const version = workflow.versions[0];
    if (!version) {
      throw new ConflictException('Workflow has no published version');
    }

    const definition = this.parseDefinition(version.definition);

    const run = await this.prisma.run.create({
      data: {
        tenantId: user.tenantId,
        workflowId,
        workflowVersionId: version.id,
        status: RunStatus.RUNNING,
        trigger: TriggerType.MANUAL,
        triggeredById: user.userId,
        startedAt: new Date(),
        steps: {
          create: definition.steps.map((step) => ({
            stepKey: step.key,
            name: step.name,
            type: StepType[step.type],
            status: StepStatus.PENDING,
          })),
        },
      },
      include: { steps: true },
    });

    // Fire-and-forget: the run continues after the HTTP response. In-process only —
    // a queue (e.g. BullMQ) would make this survive restarts; noted as a trade-off.
    void this.executeAndPersist(run.id, definition, dto.input);

    return run;
  }

  async listForWorkflow(
    user: AuthenticatedUser,
    workflowId: string,
    query: PaginationQuery,
  ): Promise<Paginated<Run>> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }

    const where: Prisma.RunWhereInput = { workflowId, tenantId: user.tenantId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.run.count({ where }),
      this.prisma.run.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
    ]);
    return paginate(data, total, query.page, query.pageSize);
  }

  async findOne(user: AuthenticatedUser, runId: string): Promise<RunWithSteps> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, tenantId: user.tenantId },
      include: { steps: true },
    });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    return run;
  }

  private async executeAndPersist(
    runId: string,
    definition: WorkflowDefinition,
    input: unknown,
  ): Promise<void> {
    try {
      const result = await this.engine.execute(definition, { input });
      await this.persistResult(runId, result);
    } catch (error) {
      this.logger.error(`Run ${runId} crashed: ${String(error)}`);
      await this.prisma.run
        .update({
          where: { id: runId },
          data: { status: RunStatus.FAILED, finishedAt: new Date() },
        })
        .catch((persistError) =>
          this.logger.error(`Failed to mark run ${runId} as failed: ${String(persistError)}`),
        );
    }
  }

  /** Writes the engine's final result into the run + step records atomically. */
  private async persistResult(runId: string, result: WorkflowRunResult): Promise<void> {
    const stepUpdates = result.steps.map((step) =>
      this.prisma.runStep.update({
        where: { runId_stepKey: { runId, stepKey: step.key } },
        data: {
          status: STEP_STATUS_MAP[step.status],
          attempts: step.attempts,
          error: step.error,
          durationMs: step.durationMs,
          startedAt: step.startedAt !== undefined ? new Date(step.startedAt) : undefined,
          finishedAt: step.finishedAt !== undefined ? new Date(step.finishedAt) : undefined,
          ...(step.output !== undefined && step.output !== null
            ? { output: step.output as Prisma.InputJsonValue }
            : {}),
        },
      }),
    );

    await this.prisma.$transaction([
      ...stepUpdates,
      this.prisma.run.update({
        where: { id: runId },
        data: {
          status: RUN_STATUS_MAP[result.status],
          finishedAt: new Date(result.finishedAt),
        },
      }),
    ]);
  }

  private parseDefinition(stored: Prisma.JsonValue): WorkflowDefinition {
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
}
