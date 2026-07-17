import { Role, RunStatus } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from './stats.service';

const user: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'viewer@acme.test',
  role: Role.VIEWER,
};

describe('StatsService', () => {
  const prismaMock = {
    run: { count: jest.fn(), groupBy: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new StatsService(prismaMock as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.run.count.mockResolvedValue(2);
    prismaMock.$queryRaw.mockResolvedValue([{ avg_ms: 1234.5 }]);
  });

  it('aggregates 24h counts, success rate, and average duration', async () => {
    prismaMock.run.groupBy.mockResolvedValue([
      { status: RunStatus.SUCCEEDED, _count: { _all: 6 } },
      { status: RunStatus.FAILED, _count: { _all: 2 } },
      { status: RunStatus.TIMED_OUT, _count: { _all: 1 } },
      { status: RunStatus.CANCELLED, _count: { _all: 1 } },
      { status: RunStatus.RUNNING, _count: { _all: 2 } },
    ]);

    const stats = await service.health(user);

    expect(stats.activeRuns).toBe(2);
    expect(stats.last24h).toEqual({
      total: 12,
      succeeded: 6,
      failed: 4, // FAILED + TIMED_OUT + CANCELLED
      successRate: 0.6, // 6 / (6 + 4)
      avgDurationMs: 1234.5,
    });
  });

  it('returns nulls when nothing has finished yet', async () => {
    prismaMock.run.count.mockResolvedValue(0);
    prismaMock.run.groupBy.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([{ avg_ms: null }]);

    const stats = await service.health(user);

    expect(stats.last24h.total).toBe(0);
    expect(stats.last24h.successRate).toBeNull();
    expect(stats.last24h.avgDurationMs).toBeNull();
  });

  it('scopes every query to the tenant', async () => {
    prismaMock.run.groupBy.mockResolvedValue([]);
    await service.health(user);

    expect(prismaMock.run.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1' }),
      }),
    );
    expect(prismaMock.run.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1' }),
      }),
    );
  });
});
