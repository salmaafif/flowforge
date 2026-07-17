# Execution Logs — Partitioned Store

> How and why `execution_logs` is a time-partitioned table, and the migration
> that converts it safely. Complements the store-choice rationale in
> [infrastructure.md §4](infrastructure.md).

## Why a separate, partitioned store

Execution logs are **append-only and the highest-volume** data in the system: one
run can emit many rows, and they're written far more often than they're read. They
are deliberately kept **out of** the transactional `runs` / `run_steps` tables and
given their own table so that log churn never bloats the indexes backing the live
dashboard.

Within that table, logs are **range-partitioned by month** on `timestamp`:

| Benefit | How partitioning delivers it |
| --- | --- |
| Cheap retention | Dropping a month = `DROP TABLE execution_logs_2026_07` (instant, no bloat) instead of a giant `DELETE` + vacuum |
| Small indexes | Each partition has its own index sized to one month, so tail reads for a run stay fast as total volume grows |
| Query pruning | Time-bounded reads scan only the partitions they overlap (verified below) |
| Isolated writes | Append traffic lands in the current month's partition, not a single ever-growing heap |

**Why not a different engine (OpenSearch / S3 / ClickHouse)?** At this scale, a
second datastore's operational cost (its own HA, backups, access control, sync)
outweighs the benefit. Postgres partitioning gives the volume characteristics we
need with one system to run. The write path is behind a repository boundary, so
promoting cold logs to S3+Athena or full-text to OpenSearch later is contained.

## Schema shape

Range partitioning requires the partition key to be in the primary key, so the id
is composite:

```prisma
model ExecutionLog {
  id        BigInt   @default(autoincrement())
  // ...
  timestamp DateTime @default(now())
  @@id([id, timestamp])            // composite PK: id + partition key
  @@index([runId, timestamp])
  @@index([tenantId, timestamp])
  @@map("execution_logs")
}
```

Indexes are declared **on the parent**; Postgres creates them on every partition —
including partitions added in the future — automatically. Prisma treats the table
as ordinary for reads/writes; it doesn't need to know it's partitioned.

## The migration (safe conversion of a live table)

Migration: [`20260717230611_partition_execution_logs`](../backend/prisma/migrations/20260717230611_partition_execution_logs/migration.sql).

Postgres can't `ALTER` a plain table into a partitioned one, so the table is
recreated. The migration is written to be **safe with or without existing data**
and is a single transaction (any failure rolls back cleanly):

1. **Detach the sequence** (`ALTER SEQUENCE ... OWNED BY NONE`) so the id sequence
   survives the old table being dropped.
2. **Rename the old table** and its constraint/indexes out of the way (freeing the
   canonical names — a subtle point: indexes travel with a renamed table).
3. **Create the partitioned parent** with composite PK `(id, "timestamp")`,
   `PARTITION BY RANGE ("timestamp")`, reusing the sequence for `id`.
4. **Re-own the sequence** by the new column.
5. **Recreate indexes and the tenant FK** on the parent.
6. **Create a `DEFAULT` partition** plus the current/next month partitions.
7. **Copy any existing rows** across, then **drop the old table**.

### Why a DEFAULT partition

An insert whose month has no matching partition would otherwise **fail**. The
`DEFAULT` partition catches those rows so writes never error. The trade-off: adding
a new month partition later must briefly scan the default for conflicting rows, so
in production a scheduled job (or `pg_partman`) pre-creates upcoming months to keep
the default empty. This is noted in [infrastructure.md](infrastructure.md).

## Verification (PostgreSQL 16)

**Routing** — inserting rows dated July, August, and 2027 landed in
`execution_logs_2026_07`, `execution_logs_2026_08`, and `execution_logs_default`
respectively.

**Pruning** — a single-day July query touched only the July partition; the others
were pruned:

```
EXPLAIN: Index Only Scan using execution_logs_2026_07_tenantId_timestamp_idx
         on execution_logs_2026_07
         Index Cond: ("tenantId" = $1 AND "timestamp" >= '2026-07-15' AND < '2026-07-16')
```

Only the relevant partition's (auto-created) index is scanned — the planner never
looks at the other months.

## Operating it in production

- **Provisioning** — a monthly job creates next month's partition ahead of time
  (`pg_partman` automates this end-to-end).
- **Retention** — drop partitions past the retention window; optionally
  `DETACH` + archive to S3 first for cold storage.
- **Backfill/migration** — because reads/writes go through the parent, application
  code is unaffected by partition maintenance.
