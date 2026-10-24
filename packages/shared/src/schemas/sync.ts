import { z } from 'zod';
import { ORDER_STATUSES } from '../orders';
import { GeoPoint } from '../geo';
import { AccountAddress, AccountStatus, ContactResult, LocationStatus } from './accounts';
import { ItemResult, PriceListScope } from './catalogue';
import { PlanItemStatus } from './planning';
import { Key } from './config';
import { UserStatus } from './iam';
import { TerritoryResult } from './territories';

/**
 * The mobile sync protocol (spec 11.3, decision D40). The phone pulls the reference data it may
 * read offline, entity by entity, a page at a time, and pushes what it captured through its own
 * outbox. Each module adds its entities here as it arrives.
 */

export const SYNC_ENTITIES = [
  'users',
  'territories',
  'accounts',
  'contacts',
  'items',
  'plan_items',
  'price_lists',
  'prices',
  'orders',
  'balances',
] as const;
export const SyncEntity = z.enum(SYNC_ENTITIES).meta({ id: 'SyncEntity' });

/** At most this many rows of one entity in one page (spec 11.3). */
export const SYNC_PAGE_SIZE = 500;

export const SyncPullQuery = z.strictObject({
  entities: z
    .string()
    .meta({ description: 'Comma-separated, such as `users,territories`' })
    .transform((value) => [
      ...new Set(
        value
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(SyncEntity).min(1)),
  cursor: z
    .string()
    .max(8_192)
    .optional()
    .meta({ description: 'The cursor the previous pull returned; leave out on a first sync' }),
  limit: z.coerce.number().int().min(1).max(SYNC_PAGE_SIZE).default(SYNC_PAGE_SIZE),
});

/** A person as the phone keeps them: the caller, and the people a manager's scope reaches. */
export const SyncUser = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    designation: Key,
    role: Key,
    managerId: z.uuid().nullable(),
    status: UserStatus,
  })
  .meta({ id: 'SyncUser' });

/** A node of the tenant's territory tree (spec 5.4), as `GET /v1/territories` lists it. */
export const SyncTerritory = TerritoryResult;

/**
 * An account as the phone keeps it (spec 5.5): the ones the caller sees, offline included, with
 * today's slot holders.
 */
export const SyncAccount = z
  .object({
    id: z.uuid(),
    type: Key,
    code: z.string(),
    name: z.string(),
    territoryId: z.uuid(),
    parentId: z.uuid().nullable(),
    address: AccountAddress,
    location: GeoPoint.nullable(),
    geofenceRadiusM: z.int().nullable(),
    locationStatus: LocationStatus,
    status: AccountStatus,
    segments: z.array(Key),
    custom: z.record(z.string(), z.unknown()),
    slots: z.array(z.object({ slot: Key, userId: z.uuid() })),
  })
  .meta({ id: 'SyncAccount' });

/** A contact person of an account the phone keeps. */
export const SyncContact = ContactResult;

/**
 * A catalogue item (spec 5.11), for item lines and catalogue choices offline. Every phone keeps
 * the whole catalogue, inactive items included, so lines already entered still read.
 */
export const SyncItem = ItemResult;

/**
 * The person's own plan items (M8), from yesterday to the end of next month, for today's plan
 * offline. Where months are approved, only an approved month's items, and the person's own.
 */
export const SyncPlanItem = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    date: z.iso.date(),
    purpose: z.string().nullable(),
    note: z.string().nullable(),
    status: PlanItemStatus,
    source: z.enum(['route', 'adhoc']),
    visitId: z.uuid().nullable(),
  })
  .meta({ id: 'SyncPlanItem' });

/**
 * A price list the phone keeps (spec 5.11, decision D77): every list for everyone, account types,
 * segments or territories, and the lists for single accounts the person sees, so the phone works
 * out an account's prices offline with `applicableLists()`.
 */
export const SyncPriceList = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scope: PriceListScope,
    targets: z.array(z.string()),
    priority: z.int(),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable(),
    active: z.boolean(),
  })
  .meta({ id: 'SyncPriceList' });

/** One item's price on a list the phone keeps; a removed price comes as `removed`. */
export const SyncPrice = z
  .object({
    id: z.uuid(),
    priceListId: z.uuid(),
    itemId: z.uuid(),
    /** Per base unit. */
    price: z.string(),
    discount: z.string(),
    removed: z.boolean(),
  })
  .meta({ id: 'SyncPrice' });

/**
 * An order the person placed (M10, decision D78), so the phone shows where each stands once it
 * has left the upload queue.
 */
export const SyncOrder = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    placedAt: z.iso.datetime(),
    status: z.enum(ORDER_STATUSES),
    total: z.string(),
    lineCount: z.int().min(1),
    rejectionReason: z.string().nullable(),
  })
  .meta({ id: 'SyncOrder' });

/**
 * What an account the person sees owed on its latest balance (M11, decision D79), one row an
 * account, keyed by the account, so the phone shows it offline and warns of an order over the
 * credit limit. Only for people who may see finance.
 */
export const SyncBalance = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    asOf: z.iso.date(),
    outstanding: z.string(),
    creditLimit: z.string().nullable(),
    ageing: z.record(z.string(), z.string()),
  })
  .meta({ id: 'SyncBalance' });

/**
 * One page of one entity. A `full` pass sends every row the caller may hold: when its last page
 * arrives (`done`), the phone drops the rows of that entity the pass did not send. A `changes`
 * pass sends the rows written since the last pass, and the IDs of rows to drop.
 */
function page<T extends z.ZodType>(row: T) {
  return z.object({
    pass: z.enum(['full', 'changes']),
    /** The first page of its pass. A full pass starts a fresh copy of the entity. */
    first: z.boolean(),
    /** The last page of its pass: the phone's copy of the entity is now complete. */
    done: z.boolean(),
    rows: z.array(row),
    removed: z.array(z.uuid()),
  });
}

export const SyncUsersPage = page(SyncUser);
export const SyncTerritoriesPage = page(SyncTerritory);
export const SyncAccountsPage = page(SyncAccount);
export const SyncContactsPage = page(SyncContact);
export const SyncItemsPage = page(SyncItem);
export const SyncPlanItemsPage = page(SyncPlanItem);
export const SyncPriceListsPage = page(SyncPriceList);
export const SyncPricesPage = page(SyncPrice);
export const SyncOrdersPage = page(SyncOrder);
export const SyncBalancesPage = page(SyncBalance);

export const SyncPullResult = z.object({
  entities: z.object({
    users: SyncUsersPage.optional(),
    territories: SyncTerritoriesPage.optional(),
    accounts: SyncAccountsPage.optional(),
    contacts: SyncContactsPage.optional(),
    items: SyncItemsPage.optional(),
    plan_items: SyncPlanItemsPage.optional(),
    price_lists: SyncPriceListsPage.optional(),
    prices: SyncPricesPage.optional(),
    orders: SyncOrdersPage.optional(),
    balances: SyncBalancesPage.optional(),
  }),
  /** Send it with the next pull. It is opaque: its contents may change at any release. */
  cursor: z.string(),
  /** Some entity has more pages: pull again straight away. */
  more: z.boolean(),
});

export type SyncEntity = z.infer<typeof SyncEntity>;
export type SyncPullQuery = z.output<typeof SyncPullQuery>;
export type SyncUser = z.infer<typeof SyncUser>;
export type SyncTerritory = z.infer<typeof SyncTerritory>;
export type SyncAccount = z.infer<typeof SyncAccount>;
export type SyncContact = z.infer<typeof SyncContact>;
export type SyncItem = z.infer<typeof SyncItem>;
export type SyncPlanItem = z.infer<typeof SyncPlanItem>;
export type SyncPriceList = z.infer<typeof SyncPriceList>;
export type SyncPrice = z.infer<typeof SyncPrice>;
export type SyncOrder = z.infer<typeof SyncOrder>;
export type SyncBalance = z.infer<typeof SyncBalance>;
export type SyncPullResult = z.infer<typeof SyncPullResult>;
