// The worker entrypoint (spec 9.4): runs background jobs (spec 12.3) and the outbox relay.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from './app';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { Queues } from './platform/queues';

const config = loadConfig({ ...process.env, OUTBOX_RELAY: process.env.OUTBOX_RELAY ?? 'true' });
const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
  logger: createLogger(config),
});
app.enableShutdownHooks();
app.get(Queues).startWorkers();
