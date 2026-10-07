import { z } from 'zod';
import { Key } from './config';
import { UserStatus } from './iam';

/**
 * The mobile sync protocol (spec 11.3, decision D40). The phone pulls the reference data it may
 * read offline, entity by entity, a page at a time, and pushes what it captured through its own
 * outbox. Each module adds its entities here as it arrives.
 */

export const SYNC_ENTITIES = ['users', 'territories'] as const;
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

/** A node of the tenant's territory tree (spec 5.4). */
export const SyncTerritory = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    level: z.int(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
  })
  .meta({ id: 'SyncTerritory' });

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

export const SyncPullResult = z.object({
  entities: z.object({
    users: SyncUsersPage.optional(),
    territories: SyncTerritoriesPage.optional(),
  }),
  /** Send it with the next pull. It is opaque: its contents may change at any release. */
  cursor: z.string(),
  /** Some entity has more pages: pull again straight away. */
  more: z.boolean(),
});

const PermissionState = z.enum(['granted', 'denied', 'undetermined']);

/**
 * `POST /v1/devices/heartbeat`: the phone's health (spec 12.1, M3), sent when the app starts and
 * every 15 minutes on duty. A permission or setting the app can't read yet is left out.
 */
export const DeviceHeartbeatBody = z.strictObject({
  appVersion: z.string().trim().min(1).max(32),
  osVersion: z.string().trim().min(1).max(32),
  model: z.string().trim().min(1).max(100).optional(),
  permissions: z
    .strictObject({
      backgroundLocation: PermissionState.optional(),
      notifications: PermissionState.optional(),
      camera: PermissionState.optional(),
    })
    .default({}),
  /** Whether the phone's battery optimisation may stop the app in the background. */
  batteryOptimised: z.boolean().optional(),
  queue: z.strictObject({
    queued: z.int().min(0),
    parked: z.int().min(0),
    oldestQueuedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
});

/** What the cell keeps of a heartbeat in `devices.health`, with when it arrived. */
export const DeviceHealth = DeviceHeartbeatBody.extend({
  receivedAt: z.iso.datetime(),
  /** Device time minus server time when it arrived, from `X-Device-Time` (BR-44). */
  clockSkewSeconds: z.int().nullable(),
}).meta({ id: 'DeviceHealth' });

export type SyncEntity = z.infer<typeof SyncEntity>;
export type SyncPullQuery = z.output<typeof SyncPullQuery>;
export type SyncUser = z.infer<typeof SyncUser>;
export type SyncTerritory = z.infer<typeof SyncTerritory>;
export type SyncPullResult = z.infer<typeof SyncPullResult>;
export type DeviceHeartbeatBody = z.output<typeof DeviceHeartbeatBody>;
export type DeviceHealth = z.infer<typeof DeviceHealth>;
