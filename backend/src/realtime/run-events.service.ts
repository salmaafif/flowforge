import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

import { RunEvent } from './run-events';

/**
 * In-memory pub/sub bridging the execution side (publishers) and SSE connections
 * (subscribers).
 *
 * Tenant isolation happens here: a subscriber only ever receives events whose
 * tenantId matches the one from its JWT, so cross-tenant run activity is invisible
 * by construction. In-process only — multi-instance deployments would swap this
 * for a shared broker (e.g. Redis pub/sub) behind the same interface.
 */
@Injectable()
export class RunEventsService {
  private readonly events$ = new Subject<RunEvent>();

  emit(event: Omit<RunEvent, 'timestamp'>): void {
    this.events$.next({ ...event, timestamp: new Date().toISOString() });
  }

  forTenant(tenantId: string): Observable<RunEvent> {
    return this.events$.asObservable().pipe(filter((event) => event.tenantId === tenantId));
  }
}
