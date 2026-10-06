import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { type Config, loadConfig } from './config';

/**
 * The API's modules without an HTTP server, for commands such as provisioning and the seed. The
 * outbox relay stays off: events are delivered as each transaction commits, and nothing should
 * keep a one-off command running.
 */
export async function createCommandContext(
  env: Record<string, string | undefined> = process.env,
): Promise<{ app: INestApplicationContext; config: Config }> {
  const config = loadConfig({ ...env, OUTBOX_RELAY: 'false' });
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error'],
  });
  return { app, config };
}

/** Prints what went wrong in words, and marks the command as failed once it exits. */
export function report(error: unknown): void {
  const details =
    error && typeof error === 'object' && 'details' in error && Array.isArray(error.details)
      ? (error.details as { path: string; issue: string }[])
      : [];
  console.error(error instanceof Error ? error.message : String(error));
  for (const { path, issue } of details) console.error(`  ${path}: ${issue}`);
  process.exitCode = 1;
}
