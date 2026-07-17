import { Injectable } from '@nestjs/common';
import { RunStatus } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthStats {
  /** Runs currently executing. */
  activeRuns: number;
  last24h: {
    total: number;
    succeeded: number;
    /** FAILED + TIMED_OUT + CANCELLED. */
    failed: number;
    /** succeeded / (succeeded + failed); null when nothing finished yet. */
    successRate: number | null;
    /** Mean wall-clock duration of finished runs; null when nothing finished yet. */
    avgDurationMs: number | null;
  };
}

const FAILURE_STATUSES: RunStatus[] = [RunStatus.FAILED, RunStatus.TIMED_OUT, RunStatus.CANCELLED];

/** Tenant-scoped aggregates behind the dashboard's global health panel. */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async health(user: AuthenticatedUser): Promise<HealthStats> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [activeRuns, byStatus, avgRows] = await Promise.all([
      this.prisma.run.count({
        where: { tenantId: user.tenantId, status: RunStatus.RUNNING },
      }),
      this.prisma.run.groupBy({
        by: ['status'],
        where: { tenantId: user.tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Duration is derived from two columns, which Prisma's aggregate API cannot
      // express — a small raw query keeps the averaging inside Postgres.
      this.prisma.$queryRaw<Array<{ avg_ms: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000)::float8 AS avg_ms
        FROM runs
        WHERE "tenantId" = ${user.tenantId}::uuid
          AND "createdAt" >= ${since}
          AND "finishedAt" IS NOT NULL
          AND "startedAt" IS NOT NULL
      `,
    ]);

    const countOf = (statuses: RunStatus[]): number =>
      byStatus
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0);

    const succeeded = countOf([RunStatus.SUCCEEDED]);
    const failed = countOf(FAILURE_STATUSES);
    const finished = succeeded + failed;
    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);

    return {
      activeRuns,
      last24h: {
        total,
        succeeded,
        failed,
        successRate: finished > 0 ? succeeded / finished : null,
        avgDurationMs: avgRows[0]?.avg_ms ?? null,
      },
    };
  }
}
