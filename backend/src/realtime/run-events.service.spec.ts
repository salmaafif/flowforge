import { RunEvent } from './run-events';
import { RunEventsService } from './run-events.service';

describe('RunEventsService', () => {
  it('delivers events only to subscribers of the same tenant', () => {
    const service = new RunEventsService();
    const tenantA: RunEvent[] = [];
    const tenantB: RunEvent[] = [];

    service.forTenant('tenant-a').subscribe((event) => tenantA.push(event));
    service.forTenant('tenant-b').subscribe((event) => tenantB.push(event));

    service.emit({ type: 'run-started', tenantId: 'tenant-a', workflowId: 'wf', runId: 'r1' });
    service.emit({ type: 'run-finished', tenantId: 'tenant-b', workflowId: 'wf', runId: 'r2' });

    expect(tenantA.map((event) => event.runId)).toEqual(['r1']);
    expect(tenantB.map((event) => event.runId)).toEqual(['r2']);
  });

  it('stamps every event with a timestamp', () => {
    const service = new RunEventsService();
    const received: RunEvent[] = [];
    service.forTenant('t').subscribe((event) => received.push(event));

    service.emit({ type: 'step-started', tenantId: 't', workflowId: 'wf', runId: 'r' });

    expect(received[0].timestamp).toEqual(expect.any(String));
    expect(new Date(received[0].timestamp).getTime()).not.toBeNaN();
  });

  it('supports multiple subscribers per tenant (fan-out)', () => {
    const service = new RunEventsService();
    const first: RunEvent[] = [];
    const second: RunEvent[] = [];
    service.forTenant('t').subscribe((event) => first.push(event));
    service.forTenant('t').subscribe((event) => second.push(event));

    service.emit({ type: 'run-started', tenantId: 't', workflowId: 'wf', runId: 'r' });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });
});
