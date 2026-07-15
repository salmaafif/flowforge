import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';

/**
 * Application entry point. Boots the NestJS HTTP server.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`FlowForge backend listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
