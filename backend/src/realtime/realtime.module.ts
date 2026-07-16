import { Module } from '@nestjs/common';

import { EventsController } from './events.controller';
import { RunEventsService } from './run-events.service';

@Module({
  controllers: [EventsController],
  providers: [RunEventsService],
  exports: [RunEventsService],
})
export class RealtimeModule {}
