import { SchedulerRegistry } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { RunsService } from '../runs/runs.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';

// Replace CronJob so tests never start real timers.
const cronJobMock = { start: jest.fn(), stop: jest.fn() };
jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation((_expr: string, onTick: () => void) => ({
    ...cronJobMock,
    onTick,
  })),
}));

describe('WorkflowSchedulerService', () => {
  const prismaMock = { workflow: { findMany: jest.fn() } };
  const registryMock = {
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
    doesExist: jest.fn().mockReturnValue(false),
  };
  const runsMock = { triggerScheduled: jest.fn().mockResolvedValue(undefined) };

  const service = new WorkflowSchedulerService(
    prismaMock as unknown as PrismaService,
    registryMock as unknown as SchedulerRegistry,
    runsMock as unknown as RunsService,
  );

  const scheduled = {
    id: 'wf-1',
    tenantId: 'tenant-1',
    enabled: true,
    cronExpression: '*/5 * * * *',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registryMock.doesExist.mockReturnValue(false);
  });

  it('registers every scheduled workflow on boot', async () => {
    prismaMock.workflow.findMany.mockResolvedValue([scheduled, { ...scheduled, id: 'wf-2' }]);

    await service.onModuleInit();

    expect(registryMock.addCronJob).toHaveBeenCalledTimes(2);
    expect(registryMock.addCronJob).toHaveBeenCalledWith('workflow:wf-1', expect.anything());
  });

  it('sync registers an enabled workflow with a cron expression', () => {
    service.sync(scheduled);
    expect(registryMock.addCronJob).toHaveBeenCalledWith('workflow:wf-1', expect.anything());
  });

  it('sync removes the job when the workflow is disabled', () => {
    registryMock.doesExist.mockReturnValue(true);
    service.sync({ ...scheduled, enabled: false });

    expect(registryMock.deleteCronJob).toHaveBeenCalledWith('workflow:wf-1');
    expect(registryMock.addCronJob).not.toHaveBeenCalled();
  });

  it('sync removes the job when the cron expression is cleared', () => {
    registryMock.doesExist.mockReturnValue(true);
    service.sync({ ...scheduled, cronExpression: null });
    expect(registryMock.deleteCronJob).toHaveBeenCalledWith('workflow:wf-1');
  });

  it('unregister is a no-op when no job exists', () => {
    service.unregister('wf-unknown');
    expect(registryMock.deleteCronJob).not.toHaveBeenCalled();
  });

  it('the registered job ticks into RunsService.triggerScheduled', () => {
    service.sync(scheduled);
    const job = registryMock.addCronJob.mock.calls[0][1] as { onTick: () => void };

    job.onTick();
    expect(runsMock.triggerScheduled).toHaveBeenCalledWith('wf-1', 'tenant-1');
  });
});
