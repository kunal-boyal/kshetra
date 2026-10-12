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
 * schemas, and installs the PostGIS and pg_trgm extensions (spec 10.1). Local and CI databases only: in AWS the roles and their secrets come from infrastructure,
 * so this refuses any other host (spec section 0, rule 7).
 */
export async function bootstrapDatabase(urls: BootstrapUrls): Promise<void> {
  for (const url of Object.values(urls)) {
    if (!isLocalDatabase(url)) {
      throw new Error(
        `Bootstrap only runs against a database on this machine, not ${new URL(url).hostname}.`,
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
  } finally {
    await client.end();
  }
}
