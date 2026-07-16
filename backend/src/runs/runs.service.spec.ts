import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role, RunStatus, StepStatus } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { WorkflowEngine, WorkflowRunResult } from '../engine/workflow-engine';
import { PrismaService } from '../prisma/prisma.service';
import { RunsService } from './runs.service';

const validator = new WorkflowDefinitionValidator();

const user: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'editor@acme.test',
  role: Role.EDITOR,
};

const definition = validator.validate({
  steps: [
    { key: 'a', name: 'A', type: 'DELAY', config: { delayMs: 5 } },
    { key: 'b', name: 'B', type: 'DELAY', dependsOn: ['a'], config: { delayMs: 5 } },
  ],
});

const workflowWithVersion = {
  id: 'wf-1',
  tenantId: 'tenant-1',
  enabled: true,
  versions: [{ id: 'v-1', version: 1, definition }],
};

const engineResult: WorkflowRunResult = {
  status: 'FAILED',
  steps: [
    {
      key: 'a',
      type: 'DELAY',
      status: 'SUCCEEDED',
      attempts: 1,
      output: { waitedMs: 5 },
      startedAt: 1000,
      finishedAt: 1010,
      durationMs: 10,
    },
    { key: 'b', type: 'DELAY', status: 'ABORTED', attempts: 1, error: 'aborted' },
  ],
  outputs: { a: { waitedMs: 5 } },
  startedAt: 1000,
  finishedAt: 1020,
  durationMs: 20,
};

/** Lets queued microtasks (the fire-and-forget execution) settle. */
const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('RunsService', () => {
  const prismaMock = {
    workflow: { findFirst: jest.fn(), findUnique: jest.fn() },
    run: {
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    runStep: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  const engineMock = { execute: jest.fn() };

  const service = new RunsService(
    prismaMock as unknown as PrismaService,
    engineMock as unknown as WorkflowEngine,
    validator,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.workflow.findFirst.mockResolvedValue(workflowWithVersion);
    prismaMock.run.create.mockResolvedValue({ id: 'run-1', status: RunStatus.RUNNING, steps: [] });
    prismaMock.run.update.mockResolvedValue({});
    prismaMock.runStep.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prismaMock),
    );
    engineMock.execute.mockResolvedValue(engineResult);
  });

  describe('trigger', () => {
    it('creates a RUNNING run with PENDING steps and returns immediately', async () => {
      const run = await service.trigger(user, 'wf-1', {});

      expect(run.id).toBe('run-1');
      expect(prismaMock.run.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            workflowVersionId: 'v-1',
            status: RunStatus.RUNNING,
            steps: {
              create: [
                expect.objectContaining({ stepKey: 'a', status: StepStatus.PENDING }),
                expect.objectContaining({ stepKey: 'b', status: StepStatus.PENDING }),
              ],
            },
          }),
        }),
      );
    });

    it('reconciles the engine result into run and step records', async () => {
      await service.trigger(user, 'wf-1', { input: { x: 1 } });
      await flushAsync();

      expect(engineMock.execute).toHaveBeenCalledWith(definition, { input: { x: 1 } });
      // Step a: succeeded with output; step b: engine ABORTED -> stored as FAILED.
      expect(prismaMock.runStep.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { runId_stepKey: { runId: 'run-1', stepKey: 'a' } },
          data: expect.objectContaining({ status: StepStatus.SUCCEEDED, durationMs: 10 }),
        }),
      );
      expect(prismaMock.runStep.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { runId_stepKey: { runId: 'run-1', stepKey: 'b' } },
          data: expect.objectContaining({ status: StepStatus.FAILED, error: 'aborted' }),
        }),
      );
      expect(prismaMock.run.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ status: RunStatus.FAILED }),
        }),
      );
    });

    it('marks the run FAILED when the engine itself crashes', async () => {
      engineMock.execute.mockRejectedValue(new Error('engine exploded'));

      await service.trigger(user, 'wf-1', {});
      await flushAsync();

      expect(prismaMock.run.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: RunStatus.FAILED }),
        }),
      );
    });

    it('rejects a workflow from another tenant with 404', async () => {
      prismaMock.workflow.findFirst.mockResolvedValue(null);
      await expect(service.trigger(user, 'wf-x', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a disabled workflow with 409', async () => {
      prismaMock.workflow.findFirst.mockResolvedValue({ ...workflowWithVersion, enabled: false });
      await expect(service.trigger(user, 'wf-1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a workflow without versions with 409', async () => {
      prismaMock.workflow.findFirst.mockResolvedValue({ ...workflowWithVersion, versions: [] });
      await expect(service.trigger(user, 'wf-1', {})).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('triggerScheduled', () => {
    it('creates a SCHEDULED run without a triggering user', async () => {
      await service.triggerScheduled('wf-1', 'tenant-1');

      expect(prismaMock.run.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ trigger: 'SCHEDULED', triggeredById: null }),
        }),
      );
    });

    it('silently skips a workflow that was disabled meanwhile', async () => {
      prismaMock.workflow.findFirst.mockResolvedValue({ ...workflowWithVersion, enabled: false });

      await service.triggerScheduled('wf-1', 'tenant-1');
      expect(prismaMock.run.create).not.toHaveBeenCalled();
    });

    it('never throws even when the lookup explodes', async () => {
      prismaMock.workflow.findFirst.mockRejectedValue(new Error('db down'));
      await expect(service.triggerScheduled('wf-1', 'tenant-1')).resolves.toBeUndefined();
    });
  });

  describe('triggerByWebhook', () => {
    const withToken = { ...workflowWithVersion, webhookToken: 'tok-123' };

    it('creates a WEBHOOK run carrying the request body as input', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue(withToken);

      const result = await service.triggerByWebhook('tok-123', { order: 42 });
      await flushAsync();

      expect(result.runId).toBe('run-1');
      expect(prismaMock.run.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ trigger: 'WEBHOOK', triggeredById: null }),
        }),
      );
      expect(engineMock.execute).toHaveBeenCalledWith(definition, { input: { order: 42 } });
    });

    it('answers 404 for an unknown token', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue(null);
      await expect(service.triggerByWebhook('nope', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers the same 404 when the workflow is disabled', async () => {
      prismaMock.workflow.findUnique.mockResolvedValue({ ...withToken, enabled: false });
      await expect(service.triggerByWebhook('tok-123', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reads', () => {
    it('scopes run detail to the tenant', async () => {
      prismaMock.run.findFirst.mockResolvedValue(null);
      await expect(service.findOne(user, 'run-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.run.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'run-x', tenantId: 'tenant-1' } }),
      );
    });

    it('paginates run history for an owned workflow', async () => {
      prismaMock.run.count.mockResolvedValue(3);
      prismaMock.run.findMany.mockResolvedValue([{ id: 'run-1' }]);

      const result = await service.listForWorkflow(user, 'wf-1', { page: 1, pageSize: 2 });
      expect(result.meta).toEqual({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    });
  });
});
