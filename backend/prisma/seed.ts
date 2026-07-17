import {
  Prisma,
  PrismaClient,
  Role,
  RunStatus,
  StepStatus,
  StepType,
  Tenant,
  TriggerType,
  User,
  Workflow,
  WorkflowVersion,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Workflow definitions (all valid against the engine's Zod schema)
// ---------------------------------------------------------------------------

/** Intentionally failing demo: example.com/api answers 404 -> retries -> FAILED. */
const SAMPLE_ETL_DEFINITION = {
  timeoutMs: 60_000,
  steps: [
    {
      key: 'fetch',
      name: 'Fetch data',
      type: 'HTTP',
      dependsOn: [],
      config: { method: 'GET', url: 'https://example.com/api' },
      retry: {
        maxRetries: 3,
        backoff: { strategy: 'exponential', initialDelayMs: 500, factor: 2 },
      },
    },
    {
      key: 'process',
      name: 'Process data',
      type: 'SCRIPT',
      dependsOn: ['fetch'],
      config: { code: 'return input;' },
    },
    {
      key: 'check',
      name: 'Has results?',
      type: 'CONDITION',
      dependsOn: ['process'],
      config: { expression: 'outputs.process != null' },
    },
    {
      key: 'cooldown',
      name: 'Cooldown',
      type: 'DELAY',
      dependsOn: ['check'],
      config: { delayMs: 1000 },
    },
  ],
};

/** Always succeeds — nice for watching steps light up green (~5s total). */
const ORDER_PROCESSING_DEFINITION = {
  timeoutMs: 30_000,
  steps: [
    { key: 'extract', name: 'Extract', type: 'DELAY', dependsOn: [], config: { delayMs: 2000 } },
    {
      key: 'transform',
      name: 'Transform',
      type: 'SCRIPT',
      dependsOn: ['extract'],
      config: { code: 'return { rows: 42 };' },
    },
    {
      key: 'load',
      name: 'Load',
      type: 'DELAY',
      dependsOn: ['transform'],
      config: { delayMs: 2000 },
    },
  ],
};

/** Parallel branches + a conditional gate whose false result skips the merge. */
const DIAMOND_PIPELINE_DEFINITION = {
  timeoutMs: 30_000,
  steps: [
    {
      key: 'fetch',
      name: 'Fetch',
      type: 'SCRIPT',
      dependsOn: [],
      config: { code: 'return { items: 3 };' },
    },
    {
      key: 'left',
      name: 'Left branch',
      type: 'DELAY',
      dependsOn: ['fetch'],
      config: { delayMs: 1500 },
    },
    {
      key: 'right',
      name: 'Right branch',
      type: 'SCRIPT',
      dependsOn: ['fetch'],
      config: { code: 'return input.fetch.items * 10;' },
    },
    {
      key: 'gate',
      name: 'Gate >100?',
      type: 'CONDITION',
      dependsOn: ['right'],
      config: { expression: 'outputs.right > 100' },
    },
    {
      key: 'merge',
      name: 'Merge',
      type: 'SCRIPT',
      dependsOn: ['left', 'gate'],
      config: { code: 'return "done";' },
    },
  ],
};

/** Cron-scheduled workflow (daily 02:00). Shows the schedule badge in the UI. */
const NIGHTLY_REPORT_DEFINITION = {
  timeoutMs: 30_000,
  steps: [
    {
      key: 'report',
      name: 'Generate report',
      type: 'SCRIPT',
      dependsOn: [],
      config: { code: 'return { generatedAt: new Date().toISOString() };' },
    },
    { key: 'wait', name: 'Settle', type: 'DELAY', dependsOn: ['report'], config: { delayMs: 500 } },
  ],
};

/** Lives in the second tenant — invisible from salma, proving isolation. */
const TAVI_SYNC_DEFINITION = {
  timeoutMs: 30_000,
  steps: [
    { key: 'ping', name: 'Ping', type: 'DELAY', dependsOn: [], config: { delayMs: 1000 } },
    {
      key: 'sync',
      name: 'Sync records',
      type: 'SCRIPT',
      dependsOn: ['ping'],
      config: { code: 'return { synced: 7 };' },
    },
  ],
};

// ---------------------------------------------------------------------------
// Seed helpers (all idempotent)
// ---------------------------------------------------------------------------

interface SeededWorkflow {
  workflow: Workflow;
  version: WorkflowVersion;
}

async function seedTenant(name: string, slug: string): Promise<Tenant> {
  return prisma.tenant.upsert({ where: { slug }, update: {}, create: { name, slug } });
}

async function seedUser(
  tenantId: string,
  email: string,
  role: Role,
  passwordHash: string,
): Promise<User> {
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { role },
    create: { tenantId, email, role, passwordHash },
  });
}

async function seedWorkflow(params: {
  tenantId: string;
  name: string;
  description: string;
  definition: object;
  createdById: string;
  cronExpression?: string;
}): Promise<SeededWorkflow> {
  const workflow = await prisma.workflow.upsert({
    where: { tenantId_name: { tenantId: params.tenantId, name: params.name } },
    update: {},
    create: {
      tenantId: params.tenantId,
      name: params.name,
      description: params.description,
      cronExpression: params.cronExpression,
    },
  });

  let version = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: workflow.id, version: 1 } },
  });
  if (!version) {
    version = await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: params.definition as Prisma.InputJsonValue,
        createdById: params.createdById,
      },
    });
  }
  return { workflow, version };
}

/**
 * Fabricates a believable run history spread over the last ~22 hours so the
 * health panel and history views have data to show. Deterministic (no RNG) and
 * only inserted when the workflow has no runs yet, so real runs are never mixed
 * with or duplicated by re-seeding.
 */
async function seedRunHistory(
  seeded: SeededWorkflow,
  tenantId: string,
  count: number,
): Promise<number> {
  const existing = await prisma.run.count({ where: { workflowId: seeded.workflow.id } });
  if (existing > 0) {
    return 0;
  }

  const definition = seeded.version.definition as unknown as {
    steps: Array<{ key: string; name: string; type: keyof typeof StepType }>;
  };
  const steps = definition.steps;
  const triggers = [TriggerType.MANUAL, TriggerType.SCHEDULED, TriggerType.WEBHOOK];
  const now = Date.now();

  for (let i = 0; i < count; i += 1) {
    const failed = i % 4 === 2; // deterministic: every 4th run fails
    const failIndex = failed ? Math.min(1, steps.length - 1) : -1;
    const createdAt = new Date(now - ((i + 1) * 22 * 60 * 60 * 1000) / count);
    const durationMs = 2200 + (i % 5) * 850;
    const stepDurationMs = Math.floor(durationMs / steps.length);
    const finishedAt = new Date(createdAt.getTime() + durationMs);

    await prisma.run.create({
      data: {
        tenantId,
        workflowId: seeded.workflow.id,
        workflowVersionId: seeded.version.id,
        status: failed ? RunStatus.FAILED : RunStatus.SUCCEEDED,
        trigger: triggers[i % triggers.length],
        startedAt: createdAt,
        finishedAt,
        createdAt,
        steps: {
          create: steps.map((step, index) => {
            const stepStartedAt = new Date(createdAt.getTime() + index * stepDurationMs);
            const stepFinishedAt = new Date(stepStartedAt.getTime() + stepDurationMs);
            if (failIndex >= 0 && index > failIndex) {
              return {
                stepKey: step.key,
                name: step.name,
                type: StepType[step.type],
                status: StepStatus.SKIPPED,
                attempts: 0,
              };
            }
            if (index === failIndex) {
              return {
                stepKey: step.key,
                name: step.name,
                type: StepType[step.type],
                status: StepStatus.FAILED,
                attempts: 3,
                error: 'Simulated failure (seeded history)',
                startedAt: stepStartedAt,
                finishedAt: stepFinishedAt,
                durationMs: stepDurationMs,
              };
            }
            return {
              stepKey: step.key,
              name: step.name,
              type: StepType[step.type],
              status: StepStatus.SUCCEEDED,
              attempts: 1,
              output: { seeded: true, step: step.key } as Prisma.InputJsonValue,
              startedAt: stepStartedAt,
              finishedAt: stepFinishedAt,
              durationMs: stepDurationMs,
            };
          }),
        },
      },
    });
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash('password123', 10);

  // Tenant 1: salma — the main playground.
  const salma = await seedTenant('Salma Corp', 'salma');
  const salmaAdmin = await seedUser(salma.id, 'admin@salma.test', Role.ADMIN, passwordHash);
  await seedUser(salma.id, 'editor@salma.test', Role.EDITOR, passwordHash);
  await seedUser(salma.id, 'viewer@salma.test', Role.VIEWER, passwordHash);

  // Tenant 2: tavi — log in as admin@tavi.test to see tenant isolation.
  const tavi = await seedTenant('Tavi Corp', 'tavi');
  const taviAdmin = await seedUser(tavi.id, 'admin@tavi.test', Role.ADMIN, passwordHash);

  const sampleEtl = await seedWorkflow({
    tenantId: salma.id,
    name: 'Sample ETL',
    description: 'Failure demo: the HTTP step gets a 404, retries 3x, then fails',
    definition: SAMPLE_ETL_DEFINITION,
    createdById: salmaAdmin.id,
  });
  const orders = await seedWorkflow({
    tenantId: salma.id,
    name: 'Order Processing',
    description: 'Always succeeds — watch the steps go green (~5s)',
    definition: ORDER_PROCESSING_DEFINITION,
    createdById: salmaAdmin.id,
  });
  const diamond = await seedWorkflow({
    tenantId: salma.id,
    name: 'Diamond Pipeline',
    description: 'Parallel branches + conditional gate that skips the merge',
    definition: DIAMOND_PIPELINE_DEFINITION,
    createdById: salmaAdmin.id,
  });
  const nightly = await seedWorkflow({
    tenantId: salma.id,
    name: 'Nightly Report',
    description: 'Cron-scheduled daily at 02:00',
    definition: NIGHTLY_REPORT_DEFINITION,
    createdById: salmaAdmin.id,
    cronExpression: '0 2 * * *',
  });
  const taviSync = await seedWorkflow({
    tenantId: tavi.id,
    name: 'Tavi Sync',
    description: 'Belongs to the tavi tenant — invisible from salma',
    definition: TAVI_SYNC_DEFINITION,
    createdById: taviAdmin.id,
  });

  const historyCounts = [
    await seedRunHistory(orders, salma.id, 14),
    await seedRunHistory(diamond, salma.id, 6),
    await seedRunHistory(nightly, salma.id, 4),
    await seedRunHistory(taviSync, tavi.id, 5),
  ];
  const insertedRuns = historyCounts.reduce((sum, value) => sum + value, 0);

  console.log(
    `Seeded tenants "salma" (4 workflows) and "tavi" (1 workflow); ` +
      `${insertedRuns} dummy runs inserted (existing histories left untouched). ` +
      `Sample ETL id: ${sampleEtl.workflow.id}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
