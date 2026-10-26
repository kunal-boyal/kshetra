// The scheduler entrypoint (spec 9.4): adds scheduled jobs (spec 12.3), which the worker runs, and
// reports the cell's health each minute (decision D93).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from './app';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { startErrorReports } from './platform/error-reports';
import { CellHealthReporter } from './modules/scheduling/cell-health-reporter';
import { TenantScheduler } from './modules/scheduling/tenant-scheduler';

const config = loadConfig();
startErrorReports(config, 'scheduler');
const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
  logger: createLogger(config),
});
app.enableShutdownHooks();
await app.get(TenantScheduler).start();
app.get(CellHealthReporter).start();
