import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RunEventsService } from './run-events.service';

/**
 * SSE endpoint for the live dashboard.
 *
 * @Sse() keeps the HTTP response open as `text/event-stream`; every value the
 * returned Observable emits is written as one `data: {...}` frame, and the
 * browser's EventSource fires `onmessage` per frame with automatic reconnection.
 * Auth note: EventSource cannot set headers, so clients pass ?access_token= —
 * JwtAuthGuard accepts it as a fallback for this reason.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly runEvents: RunEventsService) {}

  @Sse('runs')
  streamRuns(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    return this.runEvents.forTenant(user.tenantId).pipe(map((event) => ({ data: event })));
  }
}
