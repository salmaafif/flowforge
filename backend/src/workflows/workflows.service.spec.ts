import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowsService } from './workflows.service';

const validator = new WorkflowDefinitionValidator();

const user: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'editor@acme.test',
  role: Role.EDITOR,
};

const validDefinition = validator.validate({
  steps: [{ key: 'a', name: 'A', type: 'DELAY', config: { delayMs: 10 } }],
});

// Passes schema validation but contains a dependency cycle (a <-> b).
const cyclicDefinition = validator.validate({
  steps: [
    { key: 'a', name: 'A', type: 'DELAY', dependsOn: ['b'], config: { delayMs: 10 } },
    { key: 'b', name: 'B', type: 'DELAY', dependsOn: ['a'], config: { delayMs: 10 } },
  ],
});

describe('WorkflowsService', () => {
  const prismaMock = {
    workflow: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workflowVersion: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const service = new WorkflowsService(prismaMock as unknown as PrismaService, validator);

  const storedWorkflow = { id: 'wf-1', tenantId: 'tenant-1', name: 'ETL' };

  beforeEach(() => {
    jest.clearAllMocks();
    // Supports both interactive ($transaction(cb)) and batch ($transaction([...])) forms.
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prismaMock),
    );
    prismaMock.workflow.findFirst.mockResolvedValue(storedWorkflow);
  });

  describe('create', () => {
    it('creates the workflow together with version 1', async () => {
      prismaMock.workflow.create.mockResolvedValue(storedWorkflow);
      prismaMock.workflowVersion.create.mockResolvedValue({ id: 'v-1', version: 1 });

      const result = await service.create(user, { name: 'ETL', definition: validDefinition });

      expect(prismaMock.workflow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'tenant-1', name: 'ETL' }),
      });
      expect(prismaMock.workflowVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workflowId: 'wf-1', version: 1, createdById: 'user-1' }),
      });
      expect(result).toEqual(expect.objectContaining({ id: 'wf-1' }));
    });

    it('rejects a cyclic definition with 400 before touching the database', async () => {
      await expect(
        service.create(user, { name: 'Bad', definition: cyclicDefinition }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('maps a unique-name violation to 409 Conflict', async () => {
      prismaMock.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(
        service.create(user, { name: 'ETL', definition: validDefinition }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns paginated data with meta', async () => {
      prismaMock.workflow.count.mockResolvedValue(45);
      prismaMock.workflow.findMany.mockResolvedValue([storedWorkflow]);

      const result = await service.findAll(user, { page: 2, pageSize: 20 });

      expect(result.meta).toEqual({ total: 45, page: 2, pageSize: 20, totalPages: 3 });
      expect(prismaMock.workflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('scopes to the tenant and applies search + enabled filters', async () => {
      prismaMock.workflow.count.mockResolvedValue(0);
      prismaMock.workflow.findMany.mockResolvedValue([]);

      await service.findAll(user, { page: 1, pageSize: 10, search: 'etl', enabled: true });

      const expectedWhere = {
        tenantId: 'tenant-1',
        name: { contains: 'etl', mode: 'insensitive' },
        enabled: true,
      };
      expect(prismaMock.workflow.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(prismaMock.workflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });
  });

  describe('findOne', () => {
    it('scopes the lookup to the tenant', async () => {
      await service.findOne(user, 'wf-1');
      expect(prismaMock.workflow.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wf-1', tenantId: 'tenant-1' },
        }),
      );
    });

    it("returns 404 for another tenant's workflow", async () => {
      prismaMock.workflow.findFirst.mockResolvedValue(null);
      await expect(service.findOne(user, 'wf-other')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update / remove', () => {
    it('returns 404 when updating a workflow outside the tenant', async () => {
      prismaMock.workflow.findFirst.mockResolvedValue(null);
      await expect(service.update(user, 'wf-x', { enabled: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.workflow.update).not.toHaveBeenCalled();
    });

    it('deletes an owned workflow', async () => {
      await service.remove(user, 'wf-1');
      expect(prismaMock.workflow.delete).toHaveBeenCalledWith({ where: { id: 'wf-1' } });
    });
  });

  describe('versioning', () => {
    it('appends the next version number', async () => {
      prismaMock.workflowVersion.findFirst.mockResolvedValue({ version: 3 });
      prismaMock.workflowVersion.create.mockResolvedValue({ id: 'v-4', version: 4 });

      await service.createVersion(user, 'wf-1', { definition: validDefinition });

      expect(prismaMock.workflowVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workflowId: 'wf-1', version: 4 }),
      });
    });

    it('rollback publishes a new version copying the target definition', async () => {
      prismaMock.workflowVersion.findUnique.mockResolvedValue({
        id: 'v-2',
        version: 2,
        definition: validDefinition,
      });
      prismaMock.workflowVersion.findFirst.mockResolvedValue({ version: 5 });
      prismaMock.workflowVersion.create.mockResolvedValue({ id: 'v-6', version: 6 });

      await service.rollback(user, 'wf-1', 2);

      expect(prismaMock.workflowVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 6, definition: validDefinition }),
      });
    });

    it('rollback to a missing version returns 404', async () => {
      prismaMock.workflowVersion.findUnique.mockResolvedValue(null);
      await expect(service.rollback(user, 'wf-1', 99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
