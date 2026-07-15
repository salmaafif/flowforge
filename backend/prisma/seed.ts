import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * A representative DAG definition used for the sample workflow. The exact shape is
 * formalised (and validated) by the execution-engine step; here it only needs to be
 * valid JSON that exercises every step type.
 */
const SAMPLE_DEFINITION = {
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
      config: { expression: 'output.length > 0' },
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

const SEED_USERS: Array<{ email: string; role: Role }> = [
  { email: 'admin@acme.test', role: Role.ADMIN },
  { email: 'editor@acme.test', role: Role.EDITOR },
  { email: 'viewer@acme.test', role: Role.VIEWER },
];

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { name: 'Acme Inc', slug: 'acme' },
  });

  const passwordHash = await bcrypt.hash('password123', 10);
  for (const user of SEED_USERS) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: user.email } },
      update: { role: user.role },
      create: { tenantId: tenant.id, email: user.email, role: user.role, passwordHash },
    });
  }

  const admin = await prisma.user.findUniqueOrThrow({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@acme.test' } },
  });

  const workflow = await prisma.workflow.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Sample ETL' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Sample ETL',
      description: 'Example HTTP -> script -> condition -> delay workflow',
    },
  });

  const version = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: workflow.id, version: 1 } },
  });
  if (!version) {
    await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: SAMPLE_DEFINITION,
        createdById: admin.id,
      },
    });
  }

  console.log(
    `Seeded tenant "${tenant.slug}" with ${SEED_USERS.length} users and workflow "${workflow.name}".`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
