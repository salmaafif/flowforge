import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import {
  createTestApp,
  createTestPrisma,
  pollRunUntilTerminal,
  resetDatabase,
  seedTenants,
  SeededTenant,
  tokenFor,
} from './setup/test-app';

/**
 * Full-run E2E: create a workflow through the API, trigger it, and follow the
 * real background execution to completion — exercising the DAG engine's parallel
 * levels, conditional skipping, retry/backoff, and failure propagation end to end.
 */
describe('Run execution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: SeededTenant;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    ({ a } = await seedTenants(prisma));
  });

  const server = () => app.getHttpServer();

  const createWorkflow = async (
    token: string,
    name: string,
    definition: unknown,
  ): Promise<string> => {
    const res = await request(server())
      .post('/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, definition })
      .expect(201);
    return res.body.id as string;
  };

  const stepStatuses = (run: Record<string, any>): Record<string, string> =>
    Object.fromEntries(run.steps.map((s: any) => [s.stepKey, s.status]));

  // Logs are flushed to the partitioned store just after the run reaches a
  // terminal status, so give the write a moment to land.
  const pollExecutionLogs = async (runId: string, timeoutMs = 5_000): Promise<any[]> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const logs = await prisma.executionLog.findMany({
        where: { runId },
        orderBy: { timestamp: 'asc' },
      });
      if (logs.length > 0 || Date.now() > deadline) {
        return logs;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  it('runs parallel branches and prunes a false conditional branch → SUCCEEDED', async () => {
    const token = tokenFor(app, a.editor);

    // seedA/seedB run in parallel; gateTrue lets its branch through, gateFalse
    // prunes afterFalse; merge consumes both parallel outputs.
    const definition = {
      timeoutMs: 30_000,
      steps: [
        {
          key: 'seedA',
          name: 'Seed A',
          type: 'SCRIPT',
          dependsOn: [],
          config: { code: 'return 1;' },
        },
        {
          key: 'seedB',
          name: 'Seed B',
          type: 'SCRIPT',
          dependsOn: [],
          config: { code: 'return 2;' },
        },
        {
          key: 'merge',
          name: 'Merge',
          type: 'SCRIPT',
          dependsOn: ['seedA', 'seedB'],
          config: { code: 'return input.seedA + input.seedB;' },
        },
        {
          key: 'gateTrue',
          name: 'Gate (true)',
          type: 'CONDITION',
          dependsOn: ['merge'],
          config: { expression: 'outputs.merge === 3' },
        },
        {
          key: 'gateFalse',
          name: 'Gate (false)',
          type: 'CONDITION',
          dependsOn: ['seedA'],
          config: { expression: 'outputs.seedA === 999' },
        },
        {
          key: 'afterTrue',
          name: 'After true',
          type: 'SCRIPT',
          dependsOn: ['gateTrue'],
          config: { code: "return 'ran';" },
        },
        {
          key: 'afterFalse',
          name: 'After false',
          type: 'SCRIPT',
          dependsOn: ['gateFalse'],
          config: { code: "return 'nope';" },
        },
      ],
    };

    const workflowId = await createWorkflow(token, 'Success Flow', definition);

    const triggered = await request(server())
      .post(`/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(202);
    expect(triggered.body.status).toBe('RUNNING');

    const run = await pollRunUntilTerminal(app, token, triggered.body.id);

    expect(run.status).toBe('SUCCEEDED');
    expect(stepStatuses(run)).toMatchObject({
      seedA: 'SUCCEEDED',
      seedB: 'SUCCEEDED',
      merge: 'SUCCEEDED',
      gateTrue: 'SUCCEEDED',
      gateFalse: 'SUCCEEDED',
      afterTrue: 'SUCCEEDED',
      afterFalse: 'SKIPPED', // pruned: its CONDITION dependency was false
    });

    const merge = run.steps.find((s: any) => s.stepKey === 'merge');
    expect(merge.output).toBe(3);

    // Per-step execution logs were written to the partitioned store, linked to
    // their run steps.
    const logs = await pollExecutionLogs(run.id);
    const messages = logs.map((l) => l.message);
    expect(messages).toContain('Run started');
    expect(messages).toContain('Step "seedA" started');
    expect(messages).toContain('Step "afterFalse" skipped (dependency not satisfied)');
    expect(messages).toContain('Run finished: SUCCEEDED');
    expect(logs.some((l) => l.runStepId !== null)).toBe(true);

    // The same logs are exposed via the paginated API endpoint.
    const logsRes = await request(server())
      .get(`/runs/${run.id}/logs?pageSize=100`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(logsRes.body.meta.total).toBe(logs.length);
    expect(logsRes.body.data.map((l: any) => l.message)).toContain('Run started');
  });

  it('retries a failing step then FAILS the run and skips downstream', async () => {
    const token = tokenFor(app, a.editor);

    const definition = {
      steps: [
        {
          key: 'boom',
          name: 'Boom',
          type: 'SCRIPT',
          dependsOn: [],
          config: { code: "throw new Error('boom');" },
          retry: { maxRetries: 2, backoff: { strategy: 'fixed', initialDelayMs: 10 } },
        },
        {
          key: 'after',
          name: 'After',
          type: 'SCRIPT',
          dependsOn: ['boom'],
          config: { code: 'return 1;' },
        },
      ],
    };

    const workflowId = await createWorkflow(token, 'Failing Flow', definition);

    const triggered = await request(server())
      .post(`/workflows/${workflowId}/trigger`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(202);

    const run = await pollRunUntilTerminal(app, token, triggered.body.id);

    expect(run.status).toBe('FAILED');
    const boom = run.steps.find((s: any) => s.stepKey === 'boom');
    expect(boom.status).toBe('FAILED');
    expect(boom.attempts).toBe(3); // 1 initial + 2 retries
    expect(boom.error).toContain('boom');
    expect(stepStatuses(run).after).toBe('SKIPPED');

    // Logs capture the retry warnings and the failure at ERROR level.
    const logs = await pollExecutionLogs(run.id);
    expect(logs.some((l) => l.level === 'WARN' && l.message.includes('retrying'))).toBe(true);
    expect(logs.some((l) => l.level === 'ERROR' && l.message.includes('"boom" failed'))).toBe(true);
    expect(logs.map((l) => l.message)).toContain('Run finished: FAILED');
  });
});
