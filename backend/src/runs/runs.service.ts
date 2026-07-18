import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LogLevel,
  Prisma,
  Run,
  RunStatus,
  StepStatus,
  StepType,
  TriggerType,
} from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { Paginated, PaginationQuery, paginate, toSkipTake } from '../common/pagination';
import { InvalidWorkflowDefinitionError } from '../engine/dag/errors';
import { WorkflowDefinition } from '../engine/dag/workflow-definition.schema';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import {
  StepEvent,
  StepOutcome,
  WorkflowEngine,
  WorkflowRunResult,
  WorkflowRunStatus,
} from '../engine/workflow-engine';
import { ExecutionLogInput, ExecutionLogService } from '../logging/execution-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RunEventsService } from '../realtime/run-events.service';
import { TriggerRunDto } from './dto/trigger-run.dto';

export type RunWithSteps = Prisma.RunGetPayload<{ include: { steps: true } }>;

/** A run annotated with its workflow's name, for cross-workflow listings. */
export type RunWithWorkflowName = Prisma.RunGetPayload<{
  include: { workflow: { select: { name: true } } };
}>;

/** A single execution-log row as returned to the dashboard (no BigInt id). */
export type ExecutionLogView = Prisma.ExecutionLogGetPayload<{
  select: { level: true; message: true; timestamp: true; runStepId: true; context: true };
}>;

/** Run detail incl. the executed definition, so the UI can draw the DAG. */
export type RunDetail = Prisma.RunGetPayload<{
  include: {
    steps: true;
    workflow: { select: { name: true } };
    workflowVersion: { select: { version: true; definition: true } };
  };
}>;

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

/** Bounds a string so a pathological error never bloats a log row. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

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
    private readonly runEvents: RunEventsService,
    private readonly executionLogs: ExecutionLogService,
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

    return this.startRun({
      tenantId: user.tenantId,
      workflowId,
      workflowVersionId: version.id,
      definition,
      trigger: TriggerType.MANUAL,
      triggeredById: user.userId,
      input: dto.input,
    });
  }

  /**
   * Public webhook entry point. The token is the only credential; every failure
   * mode (unknown token, disabled workflow, no version) answers the same 404 so
   * outsiders cannot probe which tokens exist.
   */
  async triggerByWebhook(
    token: string,
    input: unknown,
  ): Promise<{ runId: string; status: RunStatus }> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { webhookToken: token },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const version = workflow?.versions[0];
    if (!workflow?.enabled || !version) {
      throw new NotFoundException('Unknown webhook');
    }

    const definition = this.parseDefinition(version.definition);
    const run = await this.startRun({
      tenantId: workflow.tenantId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      definition,
      trigger: TriggerType.WEBHOOK,
      triggeredById: null,
      input,
    });
    return { runId: run.id, status: run.status };
  }

  /**
   * Entry point for the cron scheduler. Unlike manual triggering there is no HTTP
   * caller: problems are logged and swallowed so one broken workflow can never
   * crash the scheduler loop.
   */
  async triggerScheduled(workflowId: string, tenantId: string): Promise<void> {
    try {
      const workflow = await this.prisma.workflow.findFirst({
        where: { id: workflowId, tenantId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      const version = workflow?.versions[0];
      if (!workflow?.enabled || !version) {
        this.logger.warn(`Skipping scheduled run for workflow ${workflowId}`);
        return;
      }

      const definition = this.definitionValidator.validate(version.definition);
      await this.startRun({
        tenantId,
        workflowId,
        workflowVersionId: version.id,
        definition,
        trigger: TriggerType.SCHEDULED,
        triggeredById: null,
        input: undefined,
      });
    } catch (error) {
      this.logger.error(`Scheduled trigger failed for workflow ${workflowId}: ${String(error)}`);
    }
  }

  /** Creates the run + pending steps, then hands execution to the background. */
  private async startRun(params: {
    tenantId: string;
    workflowId: string;
    workflowVersionId: string;
    definition: WorkflowDefinition;
    trigger: TriggerType;
    triggeredById: string | null;
    input: unknown;
  }): Promise<RunWithSteps> {
    const run = await this.prisma.run.create({
      data: {
        tenantId: params.tenantId,
        workflowId: params.workflowId,
        workflowVersionId: params.workflowVersionId,
        status: RunStatus.RUNNING,
        trigger: params.trigger,
        triggeredById: params.triggeredById,
        startedAt: new Date(),
        steps: {
          create: params.definition.steps.map((step) => ({
            stepKey: step.key,
            name: step.name,
            type: StepType[step.type],
            status: StepStatus.PENDING,
          })),
        },
      },
      include: { steps: true },
    });

    this.runEvents.emit({
      type: 'run-started',
      tenantId: params.tenantId,
      workflowId: params.workflowId,
      runId: run.id,
    });

    // Fire-and-forget: the run continues after the HTTP response. In-process only —
    // a queue (e.g. BullMQ) would make this survive restarts; noted as a trade-off.
    void this.executeAndPersist({
      runId: run.id,
      tenantId: params.tenantId,
      workflowId: params.workflowId,
      definition: params.definition,
      input: params.input,
      stepIdByKey: new Map(run.steps.map((step) => [step.stepKey, step.id])),
    });

    return run;
  }

  /** Tenant-wide recent runs (across all workflows) for the dashboard's "Recent Runs" table. */
  async listRecent(
    user: AuthenticatedUser,
    query: PaginationQuery,
  ): Promise<Paginated<RunWithWorkflowName>> {
    const where: Prisma.RunWhereInput = { tenantId: user.tenantId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.run.count({ where }),
      this.prisma.run.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
        include: { workflow: { select: { name: true } } },
      }),
    ]);
    return paginate(data, total, query.page, query.pageSize);
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

  /**
   * Paginated per-run execution logs for the dashboard. `id` (a BigInt) is
   * deliberately not selected — it can't be JSON-serialised and the client keys
   * on runStepId + timestamp instead.
   */
  async listLogs(
    user: AuthenticatedUser,
    runId: string,
    query: PaginationQuery,
  ): Promise<Paginated<ExecutionLogView>> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!run) {
      throw new NotFoundException('Run not found');
    }

    const where: Prisma.ExecutionLogWhereInput = { runId, tenantId: user.tenantId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.executionLog.count({ where }),
      this.prisma.executionLog.findMany({
        where,
        orderBy: { timestamp: 'asc' },
        ...toSkipTake(query),
        select: { level: true, message: true, timestamp: true, runStepId: true, context: true },
      }),
    ]);
    return paginate(data, total, query.page, query.pageSize);
  }

  async findOne(user: AuthenticatedUser, runId: string): Promise<RunDetail> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, tenantId: user.tenantId },
      include: {
        steps: true,
        workflow: { select: { name: true } },
        workflowVersion: { select: { version: true, definition: true } },
      },
    });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    return run;
  }

  private async executeAndPersist(context: {
    runId: string;
    tenantId: string;
    workflowId: string;
    definition: WorkflowDefinition;
    input: unknown;
    stepIdByKey: Map<string, string>;
  }): Promise<void> {
    const { runId, tenantId, workflowId, definition, input } = context;

    // Buffer log entries during execution (no DB in the hot path) and flush them
    // in one write afterwards. Timestamps are captured per event to keep order.
    const logs: ExecutionLogInput[] = [
      { tenantId, runId, level: LogLevel.INFO, message: 'Run started', timestamp: new Date() },
    ];

    try {
      const result = await this.engine.execute(definition, {
        input,
        listener: {
          onStepEvent: (event) => {
            this.publishStepEvent(context, event);
            logs.push(this.stepEventToLog(context, event));
          },
        },
      });
      await this.persistResult(runId, result);
      logs.push({
        tenantId,
        runId,
        level: result.status === 'SUCCEEDED' ? LogLevel.INFO : LogLevel.ERROR,
        message: `Run finished: ${result.status}`,
        timestamp: new Date(),
      });
      this.runEvents.emit({
        type: 'run-finished',
        tenantId,
        workflowId,
        runId,
        status: RUN_STATUS_MAP[result.status],
      });
    } catch (error) {
      this.logger.error(`Run ${runId} crashed: ${String(error)}`);
      logs.push({
        tenantId,
        runId,
        level: LogLevel.ERROR,
        message: `Run crashed: ${clip(String(error), 1_000)}`,
        timestamp: new Date(),
      });
      this.runEvents.emit({
        type: 'run-finished',
        tenantId,
        workflowId,
        runId,
        status: RunStatus.FAILED,
      });
      await this.prisma.run
        .update({
          where: { id: runId },
          data: { status: RunStatus.FAILED, finishedAt: new Date() },
        })
        .catch((persistError) =>
          this.logger.error(`Failed to mark run ${runId} as failed: ${String(persistError)}`),
        );
    } finally {
      // Best-effort: a logging failure never affects the run outcome.
      await this.executionLogs.writeMany(logs);
    }
  }

  /** Maps an engine step event to an execution-log row (severity + message + context). */
  private stepEventToLog(
    context: { runId: string; tenantId: string; stepIdByKey: Map<string, string> },
    event: StepEvent,
  ): ExecutionLogInput {
    const base = {
      tenantId: context.tenantId,
      runId: context.runId,
      runStepId: context.stepIdByKey.get(event.key) ?? null,
      timestamp: new Date(),
    };

    switch (event.type) {
      case 'step-started':
        return { ...base, level: LogLevel.INFO, message: `Step "${event.key}" started` };
      case 'step-succeeded':
        return { ...base, level: LogLevel.INFO, message: `Step "${event.key}" succeeded` };
      case 'step-failed':
        return {
          ...base,
          level: LogLevel.ERROR,
          message: `Step "${event.key}" failed`,
          context: { error: clip(event.error, 1_000) },
        };
      case 'step-retrying':
        return {
          ...base,
          level: LogLevel.WARN,
          message: `Step "${event.key}" retrying (attempt ${event.attempt}, in ${event.delayMs}ms)`,
          context: { attempt: event.attempt, delayMs: event.delayMs },
        };
      case 'step-skipped':
        return {
          ...base,
          level: LogLevel.INFO,
          message: `Step "${event.key}" skipped (dependency not satisfied)`,
        };
      case 'step-aborted':
        return {
          ...base,
          level: LogLevel.WARN,
          message: `Step "${event.key}" aborted (timeout or cancellation)`,
        };
    }
  }

  /** Translates an engine step event into a tenant-tagged realtime event. */
  private publishStepEvent(
    context: { runId: string; tenantId: string; workflowId: string },
    event: StepEvent,
  ): void {
    this.runEvents.emit({
      type: event.type,
      tenantId: context.tenantId,
      workflowId: context.workflowId,
      runId: context.runId,
      stepKey: event.key,
      ...('error' in event ? { error: event.error } : {}),
      ...('output' in event ? { output: event.output } : {}),
      ...('attempt' in event ? { attempt: event.attempt, delayMs: event.delayMs } : {}),
    });
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
