import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { TEST_DATABASE_URL } from './env';

export const TEST_PASSWORD = 'password123';

/** A standalone client for seeding/resetting, pinned to the test database. */
export function createTestPrisma(): PrismaClient {
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to seed/reset a non-test database: ${dbName}`);
  }
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
}

/** Boots the real application with the rate limiter disabled for deterministic tests. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

/** Truncates every table so each test starts from a known-empty state. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "execution_logs", "run_steps", "runs", "workflow_versions", "workflows", "users", "tenants" RESTART IDENTITY CASCADE',
  );
}

export interface SeededUser {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
}

export interface SeededTenant {
  id: string;
  slug: string;
  admin: SeededUser;
  editor: SeededUser;
  viewer: SeededUser;
}

/**
 * Two tenants: A with admin/editor/viewer, B with a single admin. Used to exercise
 * RBAC and strict cross-tenant isolation. Passwords are all TEST_PASSWORD.
 */
export async function seedTenants(prisma: PrismaClient): Promise<{
  a: SeededTenant;
  b: SeededTenant;
}> {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  const addUser = (tenantId: string, slug: string, role: Role): Promise<SeededUser> =>
    prisma.user.create({
      data: { tenantId, email: `${role.toLowerCase()}@${slug}.test`, role, passwordHash },
      select: { id: true, tenantId: true, email: true, role: true },
    });

  const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A', slug: 'tenant-a' } });
  const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B', slug: 'tenant-b' } });

  const [adminA, editorA, viewerA, adminB] = await Promise.all([
    addUser(tenantA.id, 'tenant-a', Role.ADMIN),
    addUser(tenantA.id, 'tenant-a', Role.EDITOR),
    addUser(tenantA.id, 'tenant-a', Role.VIEWER),
    addUser(tenantB.id, 'tenant-b', Role.ADMIN),
  ]);

  return {
    a: { id: tenantA.id, slug: 'tenant-a', admin: adminA, editor: editorA, viewer: viewerA },
    b: { id: tenantB.id, slug: 'tenant-b', admin: adminB, editor: adminB, viewer: adminB },
  };
}

/**
 * Mints a Bearer token the same way the login endpoint does (same secret, same
 * payload shape). Used for test setup so RBAC/isolation cases don't each hammer
 * the rate-limited /auth/login route; the login flow itself is covered separately.
 */
export function tokenFor(app: INestApplication, user: SeededUser): string {
  const jwt = app.get(JwtService);
  return jwt.sign({ sub: user.id, tenantId: user.tenantId, email: user.email, role: user.role });
}

/** Logs in through the real endpoint and returns a Bearer access token. */
export async function login(
  app: INestApplication,
  tenantSlug: string,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ tenantSlug, email, password })
    .expect(200);
  return response.body.accessToken as string;
}

const TERMINAL_RUN_STATUSES = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'];

/**
 * Polls GET /runs/:id until the run reaches a terminal status (execution is
 * fire-and-forget in the background), or throws if it doesn't finish in time.
 */
export async function pollRunUntilTerminal(
  app: INestApplication,
  token: string,
  runId: string,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/runs/${runId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    if (TERMINAL_RUN_STATUSES.includes(res.body.status)) {
      return res.body;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Run ${runId} did not finish within ${timeoutMs}ms (last: ${res.body.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** A structurally valid two-step DAG (a -> b). */
export const validDefinition = {
  timeoutMs: 60_000,
  steps: [
    { key: 'a', name: 'Step A', type: 'SCRIPT', dependsOn: [], config: { code: 'return 1;' } },
    { key: 'b', name: 'Step B', type: 'SCRIPT', dependsOn: ['a'], config: { code: 'return 2;' } },
  ],
};
