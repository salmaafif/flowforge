import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { RunStatus } from '@prisma/client';

import { Public } from '../auth/decorators/public.decorator';
import { RunsService } from './runs.service';

/**
 * Public webhook endpoint. No JWT — possession of the unguessable token (192-bit
 * random, write-only after generation) is the credential. The global rate limiter
 * still applies, and the request body becomes the run's `$input`.
 */
@Controller('hooks')
export class HooksController {
  constructor(private readonly runsService: RunsService) {}

  @Public()
  @Post(':token')
  @HttpCode(HttpStatus.ACCEPTED)
  trigger(
    @Param('token') token: string,
    @Body() body: unknown,
  ): Promise<{ runId: string; status: RunStatus }> {
    return this.runsService.triggerByWebhook(token, body);
  }
}
