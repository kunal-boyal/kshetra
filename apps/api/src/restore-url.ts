/** A database URL with another host, keeping its role, password, database and options. */
export function restoredUrl(databaseUrl: string, host: string): string {
  const url = new URL(databaseUrl);
  url.hostname = host;
  return url.toString();
}
