import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Workflow } from '@prisma/client';
import { CronJob } from 'cron';

import { PrismaService } from '../prisma/prisma.service';
import { RunsService } from '../runs/runs.service';

type SchedulableWorkflow = Pick<Workflow, 'id' | 'tenantId' | 'enabled' | 'cronExpression'>;

/**
 * Keeps one dynamic cron job per scheduled workflow.
 *
 * On boot it registers every enabled workflow that has a cronExpression; after
 * that, the workflows service calls sync()/unregister() whenever a workflow is
 * created, updated, or deleted, so the registry always mirrors the database.
 */
@Injectable()
export class WorkflowSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly runsService: RunsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany({
      where: { enabled: true, cronExpression: { not: null } },
      select: { id: true, tenantId: true, enabled: true, cronExpression: true },
    });
    for (const workflow of workflows) {
      this.sync(workflow);
    }
    this.logger.log(`Registered ${workflows.length} scheduled workflow(s)`);
  }

  /** Aligns the cron registry with the workflow's current state. */
  sync(workflow: SchedulableWorkflow): void {
    this.unregister(workflow.id);
    if (workflow.enabled && workflow.cronExpression) {
      this.register(workflow.id, workflow.tenantId, workflow.cronExpression);
    }
  }

  unregister(workflowId: string): void {
    const name = this.jobName(workflowId);
    if (this.schedulerRegistry.doesExist('cron', name)) {
      this.schedulerRegistry.deleteCronJob(name);
    }
  }

  private register(workflowId: string, tenantId: string, cronExpression: string): void {
    const job = new CronJob(cronExpression, () => {
      void this.runsService.triggerScheduled(workflowId, tenantId);
    });
    this.schedulerRegistry.addCronJob(this.jobName(workflowId), job);
    job.start();
    this.logger.log(`Scheduled workflow ${workflowId} with "${cronExpression}"`);
  }

  private jobName(workflowId: string): string {
    return `workflow:${workflowId}`;
  }
}
