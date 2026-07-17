-- Convert `execution_logs` into a RANGE-partitioned table (by month on
-- "timestamp"). This table is append-only and high-volume, so partitioning:
--   * keeps per-partition indexes small (fast tail reads for one run),
--   * turns retention into an O(1) `DROP TABLE partition` instead of a mass DELETE,
--   * lets the planner prune to only the months a query touches.
--
-- Postgres cannot ALTER a plain table into a partitioned one, and range
-- partitioning requires the partition key to be part of the primary key. So the
-- table is recreated with a composite PK (id, "timestamp"); the schema keeps id
-- auto-incrementing via the original sequence.
--
-- Safe to run with or without existing data: rows are copied across before the
-- old table is dropped. It is a single transactional migration, so a failure at
-- any step rolls the whole thing back.

-- 1. Detach the identity sequence so it survives the old table being dropped.
ALTER SEQUENCE "execution_logs_id_seq" OWNED BY NONE;

-- 2. Move the existing table aside. Its indexes/constraint travel with it under
--    their original names, so rename them too, freeing the canonical names for
--    the new table's indexes (they are dropped with the old table in step 9).
ALTER TABLE "execution_logs" RENAME TO "execution_logs_old";
ALTER TABLE "execution_logs_old" RENAME CONSTRAINT "execution_logs_pkey" TO "execution_logs_old_pkey";
ALTER INDEX "execution_logs_runId_timestamp_idx" RENAME TO "execution_logs_old_runId_timestamp_idx";
ALTER INDEX "execution_logs_tenantId_timestamp_idx" RENAME TO "execution_logs_old_tenantId_timestamp_idx";

-- 3. Create the partitioned parent (same columns; composite PK includes the key).
CREATE TABLE "execution_logs" (
    "id" BIGINT NOT NULL DEFAULT nextval('execution_logs_id_seq'),
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "runStepId" UUID,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "context" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- 4. Re-own the sequence by the new table's id column.
ALTER SEQUENCE "execution_logs_id_seq" OWNED BY "execution_logs"."id";

-- 5. Indexes defined on the parent are created on every partition, now and in
--    the future, automatically.
CREATE INDEX "execution_logs_runId_timestamp_idx" ON "execution_logs"("runId", "timestamp");
CREATE INDEX "execution_logs_tenantId_timestamp_idx" ON "execution_logs"("tenantId", "timestamp");

-- 6. Foreign key back to tenants (supported from a partitioned table since PG12).
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. A DEFAULT partition catches any row whose month has no explicit partition,
--    so an insert never fails just because the monthly partition wasn't created
--    yet. A scheduled job (or pg_partman in production) pre-creates upcoming
--    months; see docs/infrastructure.md.
CREATE TABLE "execution_logs_default" PARTITION OF "execution_logs" DEFAULT;

-- 8. Seed the current and next month as concrete examples of the monthly scheme.
CREATE TABLE "execution_logs_2026_07" PARTITION OF "execution_logs"
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "execution_logs_2026_08" PARTITION OF "execution_logs"
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- 9. Carry over any existing rows, then retire the old table.
INSERT INTO "execution_logs" ("id", "tenantId", "runId", "runStepId", "level", "message", "context", "timestamp")
SELECT "id", "tenantId", "runId", "runStepId", "level", "message", "context", "timestamp"
FROM "execution_logs_old";

DROP TABLE "execution_logs_old";
