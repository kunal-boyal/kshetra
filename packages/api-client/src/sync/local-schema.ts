import type {
  SyncAccount,
  SyncContact,
  SyncEntity,
  SyncTerritory,
  SyncUser,
} from '@kshetra/shared';
import type { SqlDatabase, SqlValue } from './sql';

/**
 * The phone's database (spec 11.3): reference tables, the sync state and the outbox. Migrations
 * are numbered, run in order at app start before any sync, and only ever add: an upgrade never
 * drops the outbox. `PRAGMA user_version` holds the last one applied.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE sync_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
   CREATE TABLE outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     owner TEXT NOT NULL,
     kind TEXT NOT NULL,
     payload TEXT NOT NULL,
     depends_on TEXT NOT NULL DEFAULT '[]',
     attempts INTEGER NOT NULL DEFAULT 0,
     next_attempt_at INTEGER,
     last_error TEXT,
     last_error_code TEXT,
     state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'parked')),
     created_at INTEGER NOT NULL
   );
   CREATE INDEX outbox_owner_state ON outbox (owner, state, seq);
   CREATE TABLE ref_users (
     id TEXT PRIMARY KEY NOT NULL,
     code TEXT NOT NULL,
     name TEXT NOT NULL,
     phone TEXT,
     designation TEXT NOT NULL,
     role TEXT NOT NULL,
     manager_id TEXT,
     status TEXT NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_users_manager ON ref_users (manager_id);
   CREATE TABLE ref_territories (
     id TEXT PRIMARY KEY NOT NULL,
     parent_id TEXT,
     level INTEGER NOT NULL,
     code TEXT NOT NULL,
     name TEXT NOT NULL,
     active INTEGER NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_territories_parent ON ref_territories (parent_id);`,
  // Accounts (spec 5.5): the ones the user sees, worked offline, with their contacts.
  `CREATE TABLE ref_accounts (
     id TEXT PRIMARY KEY NOT NULL,
     type TEXT NOT NULL,
     code TEXT NOT NULL,
     name TEXT NOT NULL,
     territory_id TEXT NOT NULL,
     parent_id TEXT,
     address TEXT NOT NULL,
     lat REAL,
     lng REAL,
     geofence_radius_m INTEGER,
     location_status TEXT NOT NULL,
     status TEXT NOT NULL,
     segments TEXT NOT NULL,
     custom TEXT NOT NULL,
     slots TEXT NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_accounts_type_name ON ref_accounts (type, name);
   CREATE TABLE ref_contacts (
     id TEXT PRIMARY KEY NOT NULL,
     account_id TEXT NOT NULL,
     name TEXT NOT NULL,
     role TEXT,
     phone TEXT,
     email TEXT,
     active INTEGER NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_contacts_account ON ref_contacts (account_id);`,
];

/** Applies the migrations this database hasn't had, each in its own transaction. */
export async function migrate(db: SqlDatabase): Promise<void> {
  // WAL lets the app read while a sync writes (spec 11.3). An in-memory database stays as it is.
  await db.exec('PRAGMA journal_mode = WAL');
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  for (let version = row?.user_version ?? 0; version < MIGRATIONS.length; version += 1) {
    await db.transaction(async (tx) => {
      for (const statement of split(MIGRATIONS[version]!)) await tx.run(statement);
      await tx.run(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

function split(script: string): string[] {
  return script
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** How one synced entity sits in its reference table. */
export interface LocalEntity<Row> {
  table: string;
  /** The row as columns, `id` first. */
  columns(row: Row): Record<string, SqlValue>;
  /** A stored row back as the API sent it. */
  read(record: Record<string, SqlValue>): Row;
}

export const LOCAL_ENTITIES: { [Name in SyncEntity]: LocalEntity<RowOf<Name>> } = {
  users: {
    table: 'ref_users',
    columns: (user) => ({
      id: user.id,
      code: user.code,
      name: user.name,
      phone: user.phone,
      designation: user.designation,
      role: user.role,
      manager_id: user.managerId,
      status: user.status,
    }),
    read: (record) => ({
      id: String(record.id),
      code: String(record.code),
      name: String(record.name),
      phone: record.phone === null ? null : String(record.phone),
      designation: String(record.designation),
      role: String(record.role),
      managerId: record.manager_id === null ? null : String(record.manager_id),
      status: record.status === 'inactive' ? 'inactive' : 'active',
    }),
  },
  territories: {
    table: 'ref_territories',
    columns: (territory) => ({
      id: territory.id,
      parent_id: territory.parentId,
      level: territory.level,
      code: territory.code,
      name: territory.name,
      active: territory.active ? 1 : 0,
    }),
    read: (record) => ({
      id: String(record.id),
      parentId: record.parent_id === null ? null : String(record.parent_id),
      level: Number(record.level),
      code: String(record.code),
      name: String(record.name),
      active: record.active === 1,
    }),
  },
  accounts: {
    table: 'ref_accounts',
    columns: (account) => ({
      id: account.id,
      type: account.type,
      code: account.code,
      name: account.name,
      territory_id: account.territoryId,
      parent_id: account.parentId,
      address: JSON.stringify(account.address),
      lat: account.location?.lat ?? null,
      lng: account.location?.lng ?? null,
      geofence_radius_m: account.geofenceRadiusM,
      location_status: account.locationStatus,
      status: account.status,
      segments: JSON.stringify(account.segments),
      custom: JSON.stringify(account.custom),
      slots: JSON.stringify(account.slots),
    }),
    read: (record) => ({
      id: String(record.id),
      type: String(record.type),
      code: String(record.code),
      name: String(record.name),
      territoryId: String(record.territory_id),
      parentId: record.parent_id === null ? null : String(record.parent_id),
      address: JSON.parse(String(record.address)) as SyncAccount['address'],
      location:
        record.lat === null || record.lng === null
          ? null
          : { lat: Number(record.lat), lng: Number(record.lng) },
      geofenceRadiusM: record.geofence_radius_m === null ? null : Number(record.geofence_radius_m),
      locationStatus: record.location_status === 'verified' ? 'verified' : 'unverified',
      status: record.status as SyncAccount['status'],
      segments: JSON.parse(String(record.segments)) as string[],
      custom: JSON.parse(String(record.custom)) as Record<string, unknown>,
      slots: JSON.parse(String(record.slots)) as SyncAccount['slots'],
    }),
  },
  contacts: {
    table: 'ref_contacts',
    columns: (contact) => ({
      id: contact.id,
      account_id: contact.accountId,
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      email: contact.email,
      active: contact.active ? 1 : 0,
    }),
    read: (record) => ({
      id: String(record.id),
      accountId: String(record.account_id),
      name: String(record.name),
      role: record.role === null ? null : String(record.role),
      phone: record.phone === null ? null : String(record.phone),
      email: record.email === null ? null : String(record.email),
      active: record.active === 1,
    }),
  },
};

export type RowOf<Name extends SyncEntity> = {
  users: SyncUser;
  territories: SyncTerritory;
  accounts: SyncAccount;
  contacts: SyncContact;
}[Name];

/** Every row the phone holds of one entity. */
export async function localRows<Name extends SyncEntity>(
  db: SqlDatabase,
  name: Name,
): Promise<RowOf<Name>[]> {
  const entity = LOCAL_ENTITIES[name] as LocalEntity<RowOf<Name>>;
  const records = await db.all<Record<string, SqlValue>>(
    `SELECT * FROM ${entity.table} ORDER BY id`,
  );
  return records.map((record) => entity.read(record));
}
