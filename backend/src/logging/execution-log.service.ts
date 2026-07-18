import { Injectable, Logger } from '@nestjs/common';
import { LogLevel, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** One execution-log row to append (id/timestamp defaults handled by the DB). */
export interface ExecutionLogInput {
  tenantId: string;
  runId: string;
  runStepId?: string | null;
  level: LogLevel;
  message: string;
  context?: Prisma.InputJsonValue;
  /** Captured when the event happened, so buffered logs keep their real order. */
  timestamp: Date;
}

/**
 * Append-only writer for the high-volume, time-partitioned `execution_logs` table.
 *
 * Logging is a secondary concern: a failure here must never fail or slow a run, so
 * writes are best-effort (errors are logged and swallowed) and callers buffer
 * entries during execution and flush them in one `createMany` afterwards.
 */
@Injectable()
export class ExecutionLogService {
  private readonly logger = new Logger(ExecutionLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeMany(entries: ExecutionLogInput[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      await this.prisma.executionLog.createMany({
        data: entries.map((entry) => ({
          tenantId: entry.tenantId,
          runId: entry.runId,
          runStepId: entry.runStepId ?? null,
          level: entry.level,
          message: entry.message,
          context: entry.context,
          timestamp: entry.timestamp,
        })),
      });
    } catch (error) {
      this.logger.warn(`Failed to write ${entries.length} execution log(s): ${String(error)}`);
    }
  }
}
