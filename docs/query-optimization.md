# Query Optimization — Health Panel 24h Aggregates

> Non-trivial optimization with `EXPLAIN (ANALYZE, BUFFERS)` evidence and the
> reasoning behind the index. Measured on PostgreSQL 16 with **150,000** runs for
> one tenant spread across 60 days (so the 24-hour window is ~2,600 rows — the
> realistic shape: months of history, a small live slice).

## The query

The dashboard health panel ([`StatsService.health`](../backend/src/stats/stats.service.ts))
runs three tenant-scoped aggregates over the last 24 hours. The two that scan the
`runs` table:

```sql
-- (a) run count broken down by status
SELECT status, count(*)
FROM runs
WHERE "tenantId" = $1 AND "createdAt" >= now() - interval '24 hours'
GROUP BY status;

-- (b) mean wall-clock duration of finished runs
SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000)
FROM runs
WHERE "tenantId" = $1 AND "createdAt" >= now() - interval '24 hours'
  AND "finishedAt" IS NOT NULL AND "startedAt" IS NOT NULL;
```

Both have the same access shape: **equality on `tenantId`, range on `createdAt`.**

## Why the existing indexes didn't help

`runs` already had `(tenantId, workflowId)`, `(tenantId, status)`, and
`(workflowId, createdAt)`. None leads with `(tenantId, createdAt)`:

- `(tenantId, status)` can seek by tenant, but `status` is useless for a
  `createdAt` range, so it degrades to scanning every row for the tenant.
- `(workflowId, createdAt)` has the wrong leading column (the query doesn't filter
  by `workflowId`).

So the planner picked a **parallel sequential scan** of the whole table and threw
away ~98% of the rows via `Filter`.

## The index

```prisma
@@index([tenantId, createdAt, status])   // runs_tenantId_createdAt_status_idx
```

Column order follows the access pattern:

1. `tenantId` — **equality** first (the most selective, always-present predicate).
2. `createdAt` — **range** second (a b-tree can range-scan only after equality
   columns).
3. `status` — the **group key** last, so query (a) reads everything it needs
   (`tenantId`, `createdAt`, `status`) straight from the index → **index-only
   scan**, no heap access.

Migration: [`20260717230010_add_runs_health_index`](../backend/prisma/migrations/20260717230010_add_runs_health_index/migration.sql).

## Results (`EXPLAIN (ANALYZE, BUFFERS)`)

### (a) groupBy status

| | Plan | Execution | Shared buffers | Rows discarded |
| --- | --- | --- | --- | --- |
| **Before** | Parallel Seq Scan | **87.6 ms** | 2,428 (~19 MB) | 147k by Filter |
| **After** | **Index Only Scan** (Heap Fetches: 0) | **1.3 ms** | 23 | 0 |

```
Before:  ->  Parallel Seq Scan on runs  (rows=1324 loops=2)
               Filter: ("tenantId" = $1 AND "createdAt" >= now() - '24:00:00')
               Rows Removed by Filter: 73690
After:   ->  Index Only Scan using runs_tenantId_createdAt_status_idx on runs
               Index Cond: ("tenantId" = $1 AND "createdAt" >= now() - '24:00:00')
               Heap Fetches: 0
```

**~69× faster, buffer reads cut ~99% (2,428 → 23).**

### (b) avg duration

| | Plan | Execution | Shared buffers |
| --- | --- | --- | --- |
| **Before** | Parallel Seq Scan | **40.7 ms** | 2,420 |
| **After** | Bitmap Index Scan + heap | **13.1 ms** | 1,624 |

**~3× faster.** This query still touches the heap because the averaged columns
(`finishedAt`, `startedAt`) aren't in the index — but the bitmap heap scan visits
only the ~2,600 recent rows instead of scanning all 150k.

> **Further, if this query ever dominates:** a covering index
> `(tenantId, createdAt) INCLUDE (finishedAt, startedAt)` would make (b) index-only
> too. It's deliberately **not** added yet — it widens the index and duplicates the
> timestamp columns, a cost not justified until profiling says (b) is the
> bottleneck. The current single composite index already fixes both scans.

## Migration safety

Adding an index is **additive and backward-compatible** — no column is changed or
dropped, and old and new application versions both read the table fine, so it's
safe under a rolling deploy.

The one caveat is locking: a plain `CREATE INDEX` takes a `SHARE` lock that blocks
**writes** (not reads) while it builds. On a small/quiet table that's momentary. On
a large, write-hot production `runs` table, ship it as:

```sql
CREATE INDEX CONCURRENTLY runs_tenantId_createdAt_status_idx
  ON runs ("tenantId", "createdAt", status);
```

`CONCURRENTLY` builds without blocking writes, at the cost of not running inside a
transaction (so it can't live in Prisma's transactional migration runner — it would
be applied as a separate, non-transactional step in the deploy pipeline). For this
project's scale the standard migration is fine; the production path is documented
here and in [infrastructure.md](infrastructure.md).
