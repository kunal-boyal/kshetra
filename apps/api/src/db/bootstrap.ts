import pg from 'pg';

/** The roles every database needs before its first migration; see schema.ts. */
export const ROLES = {
  migrator: 'migrator',
  cellApp: 'cell_app',
  directoryApp: 'directory_app',
} as const;

export interface BootstrapUrls {
  /** A superuser connection. Locally that is the Docker Compose user. */
  admin: string;
  migrator: string;
  cellApp: string;
  directoryApp: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when the URL points at a database on this machine, the only kind bootstrap will touch. */
export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

/**
 * Creates the three roles with the passwords in their connection URLs, lets the migrator create
 * schemas, and installs the PostGIS, pg_trgm and pg_partman extensions (spec 10.1). It runs
 * against a database on this machine, or against the one host `confirmHost` names: a cell's
 * database in AWS, once, as a one-off task with the passwords from its secret (decision D67).
 * Nothing here deletes data, and seeds and resets stay local (spec section 0, rule 7).
 */
export async function bootstrapDatabase(urls: BootstrapUrls, confirmHost?: string): Promise<void> {
  for (const url of Object.values(urls)) {
    const host = new URL(url).hostname;
    if (!isLocalDatabase(url) && host !== confirmHost) {
      throw new Error(
        `Bootstrap runs against a database on this machine, or the host BOOTSTRAP_CONFIRM_HOST names; not ${host}.`,
      );
    }
  }

  const logins = [
    { role: ROLES.migrator, url: urls.migrator },
    { role: ROLES.cellApp, url: urls.cellApp },
    { role: ROLES.directoryApp, url: urls.directoryApp },
  ];
  const client = new pg.Client({ connectionString: urls.admin });
  await client.connect();
  try {
    for (const { role, url } of logins) {
      const { username, password } = new URL(url);
      if (decodeURIComponent(username) !== role) {
        throw new Error(`The connection URL for ${role} must sign in as ${role}, not ${username}.`);
      }
      const name = client.escapeIdentifier(role);
      const secret = client.escapeLiteral(decodeURIComponent(password));
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      const verb = exists.rowCount === 0 ? 'create' : 'alter';
      await client.query(`${verb} role ${name} with login nobypassrls password ${secret}`);
    }
    const database = client.escapeIdentifier(
      client.database ?? new URL(urls.admin).pathname.slice(1),
    );
    await client.query(
      `grant create on database ${database} to ${client.escapeIdentifier(ROLES.migrator)}`,
    );
    // PostGIS needs a superuser to install; pg_trgm comes along. In AWS, infrastructure does this.
    await client.query('create extension if not exists postgis');
    await client.query('create extension if not exists pg_trgm');
    // pg_partman keeps the raw location points in daily partitions (decision D47). It lives in
    // its own schema, and the migrator, which owns the partitioned tables, runs it.
    const migrator = client.escapeIdentifier(ROLES.migrator);
    await client.query('create schema if not exists partman');
    await client.query('create extension if not exists pg_partman schema partman');
    await client.query(`grant all on schema partman to ${migrator}`);
    await client.query(`grant all on all tables in schema partman to ${migrator}`);
    await client.query(`grant execute on all functions in schema partman to ${migrator}`);
    await client.query(`grant execute on all procedures in schema partman to ${migrator}`);
  } finally {
    await client.end();
  }
}
