import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find "Order Processing" workflow in the Salma tenant
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'salma' } });
  if (!tenant) throw new Error('Tenant not found');

  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: 'admin@salma.test' } });
  if (!admin) throw new Error('Admin not found');

  const workflow = await prisma.workflow.findUnique({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Order Processing' } },
  });

  if (!workflow) throw new Error('Workflow not found');

  console.log(`Found workflow ${workflow.name} with ID ${workflow.id}`);

  // Create version 2
  const v2Definition = {
    timeoutMs: 35_000,
    steps: [
      { key: 'extract', name: 'Extract v2', type: 'DELAY', dependsOn: [], config: { delayMs: 1500 } },
      {
        key: 'transform',
        name: 'Transform v2',
        type: 'SCRIPT',
        dependsOn: ['extract'],
        config: { code: 'return { rows: 99 };' },
      },
      {
        key: 'load',
        name: 'Load v2',
        type: 'DELAY',
        dependsOn: ['transform'],
        config: { delayMs: 1500 },
      },
    ],
  };

  await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 2,
      definition: v2Definition as Prisma.InputJsonValue,
      createdById: admin.id,
    },
  });

  // Create version 3
  const v3Definition = {
    timeoutMs: 40_000,
    steps: [
      { key: 'extract', name: 'Extract v3', type: 'DELAY', dependsOn: [], config: { delayMs: 1000 } },
      {
        key: 'transform',
        name: 'Transform v3',
        type: 'SCRIPT',
        dependsOn: ['extract'],
        config: { code: 'return { rows: 1000 };' },
      },
      {
        key: 'load',
        name: 'Load v3',
        type: 'DELAY',
        dependsOn: ['transform'],
        config: { delayMs: 1000 },
      },
    ],
  };

  await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 3,
      definition: v3Definition as Prisma.InputJsonValue,
      createdById: admin.id,
    },
  });

  console.log('Successfully added versions 2 and 3 to Order Processing workflow');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
