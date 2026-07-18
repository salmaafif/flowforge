// Runs (via jest `setupFiles`) before any application module is imported, so the
// PrismaService picks up the *test* database URL rather than the dev one from
// backend/.env. dotenv (used by @nestjs/config) does not override variables that
// are already set on process.env, so this value wins.

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://flowforge:flowforge@localhost:5433/flowforge_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
