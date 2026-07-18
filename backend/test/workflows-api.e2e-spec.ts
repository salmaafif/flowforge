import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import {
  createTestApp,
  createTestPrisma,
  resetDatabase,
  seedTenants,
  SeededTenant,
  TEST_PASSWORD,
  tokenFor,
  validDefinition,
} from './setup/test-app';

/**
 * API integration tests: exercises the real HTTP stack (global JWT + RBAC guards,
 * Zod validation, tenant scoping) against a live Postgres test database.
 */
describe('Workflows API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: SeededTenant;
  let b: SeededTenant;

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
    ({ a, b } = await seedTenants(prisma));
  });

  const server = () => app.getHttpServer();

  describe('authentication', () => {
    it('issues a token for valid credentials', async () => {
      const res = await request(server())
        .post('/auth/login')
        .send({ tenantSlug: a.slug, email: a.admin.email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ email: a.admin.email, role: 'ADMIN' });
    });

    it('rejects a wrong password with 401', async () => {
      await request(server())
        .post('/auth/login')
        .send({ tenantSlug: a.slug, email: a.admin.email, password: 'wrong' })
        .expect(401);
    });

    it('rejects a malformed body with 400', async () => {
      await request(server()).post('/auth/login').send({ tenantSlug: a.slug }).expect(400);
    });

    it('rejects protected routes without a token', async () => {
      await request(server()).get('/workflows').expect(401);
    });
  });

  describe('RBAC', () => {
    it('forbids a Viewer from creating a workflow (403)', async () => {
      const token = tokenFor(app, a.viewer);
      await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nope', definition: validDefinition })
        .expect(403);
    });

    it('allows an Editor to create a workflow (201)', async () => {
      const token = tokenFor(app, a.editor);
      const res = await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Pipeline', definition: validDefinition })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Pipeline', enabled: true });
      expect(res.body.id).toEqual(expect.any(String));
    });

    it('forbids an Editor from deleting a workflow (Admin only)', async () => {
      const editor = tokenFor(app, a.editor);
      const created = await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${editor}`)
        .send({ name: 'ToDelete', definition: validDefinition })
        .expect(201);

      await request(server())
        .delete(`/workflows/${created.body.id}`)
        .set('Authorization', `Bearer ${editor}`)
        .expect(403);

      const admin = tokenFor(app, a.admin);
      await request(server())
        .delete(`/workflows/${created.body.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(204);
    });
  });

  describe('validation', () => {
    it('rejects a definition with no steps (400)', async () => {
      const token = tokenFor(app, a.editor);
      await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Empty', definition: { steps: [] } })
        .expect(400);
    });

    it('rejects a step depending on an unknown step (400)', async () => {
      const token = tokenFor(app, a.editor);
      await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'BadDep',
          definition: {
            steps: [
              { key: 'a', name: 'A', type: 'SCRIPT', dependsOn: ['ghost'], config: { code: 'x' } },
            ],
          },
        })
        .expect(400);
    });
  });

  describe('listing & pagination', () => {
    it('returns a paginated envelope scoped to the tenant', async () => {
      const token = tokenFor(app, a.editor);
      for (const name of ['One', 'Two', 'Three']) {
        await request(server())
          .post('/workflows')
          .set('Authorization', `Bearer ${token}`)
          .send({ name, definition: validDefinition })
          .expect(201);
      }

      const res = await request(server())
        .get('/workflows?page=1&pageSize=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(3);
      expect(res.body.meta.totalPages).toBe(2);
    });
  });

  describe('tenant isolation', () => {
    it('hides one tenant’s workflow from another tenant (404)', async () => {
      const editorA = tokenFor(app, a.editor);
      const created = await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${editorA}`)
        .send({ name: 'Secret', definition: validDefinition })
        .expect(201);

      const adminB = tokenFor(app, b.admin);
      await request(server())
        .get(`/workflows/${created.body.id}`)
        .set('Authorization', `Bearer ${adminB}`)
        .expect(404);

      // Tenant B's own list is empty — no leakage.
      const listB = await request(server())
        .get('/workflows')
        .set('Authorization', `Bearer ${adminB}`)
        .expect(200);
      expect(listB.body.meta.total).toBe(0);
    });
  });

  describe('versioning & rollback', () => {
    it('creates a new version and rolls back to an earlier one', async () => {
      const token = tokenFor(app, a.editor);
      const created = await request(server())
        .post('/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Versioned', definition: validDefinition })
        .expect(201);
      const id = created.body.id;

      // A second version with a different definition.
      const v2Definition = {
        steps: [
          { key: 'only', name: 'Only', type: 'SCRIPT', dependsOn: [], config: { code: 'v2' } },
        ],
      };
      await request(server())
        .post(`/workflows/${id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ definition: v2Definition })
        .expect(201);

      const versions = await request(server())
        .get(`/workflows/${id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(versions.body).toHaveLength(2);

      // Rolling back to v1 appends a new version (history is never rewritten).
      await request(server())
        .post(`/workflows/${id}/versions/1/rollback`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const afterRollback = await request(server())
        .get(`/workflows/${id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(afterRollback.body).toHaveLength(3);
    });
  });
});
