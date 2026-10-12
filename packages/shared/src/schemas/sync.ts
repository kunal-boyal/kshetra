import { z } from 'zod';
import { GeoPoint } from '../geo';
import { AccountAddress, AccountStatus, ContactResult, LocationStatus } from './accounts';
import { Key } from './config';
import { UserStatus } from './iam';
import { TerritoryResult } from './territories';

/**
 * The mobile sync protocol (spec 11.3, decision D40). The phone pulls the reference data it may
 * read offline, entity by entity, a page at a time, and pushes what it captured through its own
 * outbox. Each module adds its entities here as it arrives.
 */

export const SYNC_ENTITIES = ['users', 'territories', 'accounts', 'contacts'] as const;
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

export const SyncPullResult = z.object({
  entities: z.object({
    users: SyncUsersPage.optional(),
    territories: SyncTerritoriesPage.optional(),
    accounts: SyncAccountsPage.optional(),
    contacts: SyncContactsPage.optional(),
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
export type SyncPullResult = z.infer<typeof SyncPullResult>;
