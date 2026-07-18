import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

/**
 * Jest globalSetup: (re)create a dedicated test database and apply all migrations
 * to it, once, before the e2e suite runs. Kept entirely separate from the dev
 * database so tests can truncate freely without touching seeded demo data.
 */
export default async function globalSetup(): Promise<void> {
  const testUrl =
    process.env.DATABASE_URL_TEST ??
    'postgresql://flowforge:flowforge@localhost:5433/flowforge_test?schema=public';

  // Guard: only ever (re)create a database whose name clearly marks it as a test
  // database, so a misconfigured URL can never drop a real one.
  const dbName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ''));
  if (!/test/i.test(dbName) || !/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(
      `Refusing to (re)create a database that is not clearly a test database: ${dbName}`,
    );
  }

  // Connect to the maintenance database to (re)create the test database.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  // Apply the migration history to the fresh database.
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
