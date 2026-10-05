import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { type BootstrapUrls, bootstrapDatabase } from '../src/db/bootstrap';
import { runMigrations } from '../src/db/migrations';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrls: BootstrapUrls;
    redisUrl: string;
  }
}

const IMAGE = 'kshetra-postgres-test:18';

/**
 * Starts one PostgreSQL and one Redis for the whole run, set up exactly as a developer's machine
 * is: the images from docker-compose.yml, `db:bootstrap`'s roles, then every migration as the
 * migrator.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const context = fileURLToPath(new URL('../../../infra/docker/postgres', import.meta.url));
  await GenericContainer.fromDockerfile(context).build(IMAGE, { deleteOnExit: false });
  const [container, redis] = await Promise.all([
    new PostgreSqlContainer(IMAGE)
      .withDatabase('kshetra')
      .withUsername('postgres')
      .withPassword('postgres')
      .start(),
    new RedisContainer('redis:8.10').start(),
  ]);

  const at = `${container.getHost()}:${container.getPort()}/kshetra`;
  const urls: BootstrapUrls = {
    admin: container.getConnectionUri(),
    migrator: `postgres://migrator:migrator-test@${at}`,
    cellApp: `postgres://cell_app:cell-app-test@${at}`,
    directoryApp: `postgres://directory_app:directory-app-test@${at}`,
  };
  await bootstrapDatabase(urls);
  await runMigrations(urls.migrator, fileURLToPath(new URL('../drizzle', import.meta.url)));
  project.provide('databaseUrls', urls);
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([container.stop(), redis.stop()]);
  };
}
