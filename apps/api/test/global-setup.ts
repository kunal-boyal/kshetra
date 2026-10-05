import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { type BootstrapUrls, bootstrapDatabase } from '../src/db/bootstrap';
import { runMigrations } from '../src/db/migrations';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrls: BootstrapUrls;
  }
}

const IMAGE = 'kshetra-postgres-test:18';

/**
 * Starts one PostgreSQL for the whole run, set up exactly as a developer's machine is: the image
 * from docker-compose.yml, `db:bootstrap`'s roles, then every migration as the migrator.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const context = fileURLToPath(new URL('../../../infra/docker/postgres', import.meta.url));
  await GenericContainer.fromDockerfile(context).build(IMAGE, { deleteOnExit: false });
  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('kshetra')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

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

  return async () => {
    await container.stop();
  };
}
