import type {
  MeasureType,
  SyncPlanItem,
  SyncAccount,
  SyncBalance,
  SyncContact,
  SyncEntity,
  SyncItem,
  SyncOrder,
  SyncPrice,
  SyncPriceList,
  SyncTerritory,
  SyncUser,
} from '@thelamp/shared';
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
  // The catalogue (spec 5.11), and forms being filled: drafts, and entries submitted on the phone
  // that wait to be sent. Each entry keeps the form version it was started on (spec 5.6).
  `CREATE TABLE ref_items (
     id TEXT PRIMARY KEY NOT NULL,
     code TEXT NOT NULL,
     name TEXT NOT NULL,
     product_id TEXT NOT NULL,
     product_name TEXT NOT NULL,
     category_id TEXT,
     category_name TEXT,
     pack_label TEXT,
     hsn TEXT,
     tax_rate TEXT NOT NULL,
     mrp TEXT,
     base_unit TEXT NOT NULL,
     units TEXT NOT NULL,
     measure_type TEXT,
     measure_per_base_unit TEXT,
     custom TEXT NOT NULL,
     active INTEGER NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_items_product_name ON ref_items (product_name, name);
   CREATE TABLE form_entries (
     id TEXT PRIMARY KEY NOT NULL,
     owner TEXT NOT NULL,
     form_key TEXT NOT NULL,
     form_version INTEGER NOT NULL,
     definition TEXT NOT NULL,
     account_id TEXT,
     data TEXT NOT NULL,
     photos TEXT NOT NULL DEFAULT '[]',
     signature TEXT,
     state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'queued')),
     started_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     submitted_at INTEGER
   );
   CREATE INDEX form_entries_owner_state ON form_entries (owner, state, updated_at);`,
  // Tracking (M5, spec 12.1): the open shift the background task reads, and the points waiting
  // to upload. Each belongs to the person signed in when it was made.
  `CREATE TABLE shift_state (
     owner TEXT PRIMARY KEY NOT NULL,
     shift_id TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     ends_by INTEGER NOT NULL,
     interval_s INTEGER NOT NULL,
     pause_id TEXT
   );
   CREATE TABLE location_buffer (
     id TEXT PRIMARY KEY NOT NULL,
     owner TEXT NOT NULL,
     shift_id TEXT NOT NULL,
     captured_at INTEGER NOT NULL,
     lat REAL NOT NULL,
     lng REAL NOT NULL,
     accuracy REAL NOT NULL,
     speed REAL,
     mocked INTEGER NOT NULL,
     source TEXT NOT NULL,
     battery INTEGER
   );
   CREATE INDEX location_buffer_owner ON location_buffer (owner, captured_at);`,
  // Visits (M6): the open visit, and what a submitted entry was captured with. Entries queued
  // before submissions could be sent carry no fix, so they go back to drafts to submit again.
  `CREATE TABLE visit_state (
     owner TEXT PRIMARY KEY NOT NULL,
     visit_id TEXT NOT NULL,
     account_id TEXT NOT NULL,
     shift_id TEXT NOT NULL,
     checked_in_at INTEGER NOT NULL,
     last_activity_at INTEGER NOT NULL
   );
   ALTER TABLE form_entries ADD COLUMN visit_id TEXT;
   ALTER TABLE form_entries ADD COLUMN captured_at INTEGER;
   ALTER TABLE form_entries ADD COLUMN fix TEXT;
   UPDATE form_entries SET state = 'draft', submitted_at = NULL WHERE state = 'queued';`,
  // Plans (M8): the person's own plan items, for today's plan offline.
  `CREATE TABLE ref_plan_items (
     id TEXT PRIMARY KEY NOT NULL,
     account_id TEXT NOT NULL,
     date TEXT NOT NULL,
     purpose TEXT,
     note TEXT,
     status TEXT NOT NULL,
     source TEXT NOT NULL,
     visit_id TEXT,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_plan_items_date ON ref_plan_items (date);`,
  // Prices (spec 5.11, decision D77): the price lists that can apply to the person's accounts and
  // their prices, so the phone works out what an account pays offline.
  `CREATE TABLE ref_price_lists (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     scope TEXT NOT NULL,
     targets TEXT NOT NULL,
     priority INTEGER NOT NULL,
     valid_from TEXT NOT NULL,
     valid_to TEXT,
     active INTEGER NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE TABLE ref_prices (
     id TEXT PRIMARY KEY NOT NULL,
     price_list_id TEXT NOT NULL,
     item_id TEXT NOT NULL,
     price TEXT NOT NULL,
     discount TEXT NOT NULL,
     removed INTEGER NOT NULL,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_prices_list_item ON ref_prices (price_list_id, item_id);`,
  // Orders (M10, decision D78): the ones the person placed, with where each stands.
  `CREATE TABLE ref_orders (
     id TEXT PRIMARY KEY NOT NULL,
     account_id TEXT NOT NULL,
     placed_at TEXT NOT NULL,
     status TEXT NOT NULL,
     total TEXT NOT NULL,
     line_count INTEGER NOT NULL,
     rejection_reason TEXT,
     sync_gen INTEGER NOT NULL
   );
   CREATE INDEX ref_orders_account ON ref_orders (account_id, placed_at);`,
  // Account finance (M11, decision D79): each account's latest balance, keyed by the account.
  `CREATE TABLE ref_balances (
     id TEXT PRIMARY KEY NOT NULL,
     account_id TEXT NOT NULL,
     as_of TEXT NOT NULL,
     outstanding TEXT NOT NULL,
     credit_limit TEXT,
     ageing TEXT NOT NULL,
     sync_gen INTEGER NOT NULL
   );`,
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
  items: {
    table: 'ref_items',
    columns: (item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      product_id: item.product.id,
      product_name: item.product.name,
      category_id: item.category?.id ?? null,
      category_name: item.category?.name ?? null,
      pack_label: item.packLabel,
      hsn: item.hsn,
      tax_rate: item.taxRate,
      mrp: item.mrp,
      base_unit: item.baseUnit,
      units: JSON.stringify(item.units),
      measure_type: item.measureType,
      measure_per_base_unit: item.measurePerBaseUnit,
      custom: JSON.stringify(item.custom),
      active: item.active ? 1 : 0,
    }),
    read: (record) => ({
      id: String(record.id),
      code: String(record.code),
      name: String(record.name),
      product: { id: String(record.product_id), name: String(record.product_name) },
      category:
        record.category_id === null
          ? null
          : { id: String(record.category_id), name: String(record.category_name) },
      packLabel: record.pack_label === null ? null : String(record.pack_label),
      hsn: record.hsn === null ? null : String(record.hsn),
      taxRate: String(record.tax_rate),
      mrp: record.mrp === null ? null : String(record.mrp),
      baseUnit: String(record.base_unit),
      units: JSON.parse(String(record.units)) as SyncItem['units'],
      measureType:
        record.measure_type === null ? null : (String(record.measure_type) as MeasureType),
      measurePerBaseUnit:
        record.measure_per_base_unit === null ? null : String(record.measure_per_base_unit),
      custom: JSON.parse(String(record.custom)) as Record<string, unknown>,
      active: record.active === 1,
    }),
  },
  plan_items: {
    table: 'ref_plan_items',
    columns: (item) => ({
      id: item.id,
      account_id: item.accountId,
      date: item.date,
      purpose: item.purpose,
      note: item.note,
      status: item.status,
      source: item.source,
      visit_id: item.visitId,
    }),
    read: (record) => ({
      id: String(record.id),
      accountId: String(record.account_id),
      date: String(record.date),
      purpose: record.purpose === null ? null : String(record.purpose),
      note: record.note === null ? null : String(record.note),
      status: String(record.status) as SyncPlanItem['status'],
      source: record.source === 'route' ? 'route' : 'adhoc',
      visitId: record.visit_id === null ? null : String(record.visit_id),
    }),
  },
  price_lists: {
    table: 'ref_price_lists',
    columns: (list) => ({
      id: list.id,
      name: list.name,
      scope: list.scope,
      targets: JSON.stringify(list.targets),
      priority: list.priority,
      valid_from: list.validFrom,
      valid_to: list.validTo,
      active: list.active ? 1 : 0,
    }),
    read: (record) => ({
      id: String(record.id),
      name: String(record.name),
      scope: String(record.scope) as SyncPriceList['scope'],
      targets: JSON.parse(String(record.targets)) as string[],
      priority: Number(record.priority),
      validFrom: String(record.valid_from),
      validTo: record.valid_to === null ? null : String(record.valid_to),
      active: record.active === 1,
    }),
  },
  prices: {
    table: 'ref_prices',
    columns: (price) => ({
      id: price.id,
      price_list_id: price.priceListId,
      item_id: price.itemId,
      price: price.price,
      discount: price.discount,
      removed: price.removed ? 1 : 0,
    }),
    read: (record) => ({
      id: String(record.id),
      priceListId: String(record.price_list_id),
      itemId: String(record.item_id),
      price: String(record.price),
      discount: String(record.discount),
      removed: record.removed === 1,
    }),
  },
  orders: {
    table: 'ref_orders',
    columns: (order) => ({
      id: order.id,
      account_id: order.accountId,
      placed_at: order.placedAt,
      status: order.status,
      total: order.total,
      line_count: order.lineCount,
      rejection_reason: order.rejectionReason,
    }),
    read: (record) => ({
      id: String(record.id),
      accountId: String(record.account_id),
      placedAt: String(record.placed_at),
      status: String(record.status) as SyncOrder['status'],
      total: String(record.total),
      lineCount: Number(record.line_count),
      rejectionReason: record.rejection_reason === null ? null : String(record.rejection_reason),
    }),
  },
  balances: {
    table: 'ref_balances',
    columns: (balance) => ({
      id: balance.id,
      account_id: balance.accountId,
      as_of: balance.asOf,
      outstanding: balance.outstanding,
      credit_limit: balance.creditLimit,
      ageing: JSON.stringify(balance.ageing),
    }),
    read: (record) => ({
      id: String(record.id),
      accountId: String(record.account_id),
      asOf: String(record.as_of),
      outstanding: String(record.outstanding),
      creditLimit: record.credit_limit === null ? null : String(record.credit_limit),
      ageing: JSON.parse(String(record.ageing)) as Record<string, string>,
    }),
  },
};

export type RowOf<Name extends SyncEntity> = {
  users: SyncUser;
  territories: SyncTerritory;
  accounts: SyncAccount;
  contacts: SyncContact;
  items: SyncItem;
  plan_items: SyncPlanItem;
  price_lists: SyncPriceList;
  prices: SyncPrice;
  orders: SyncOrder;
  balances: SyncBalance;
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
