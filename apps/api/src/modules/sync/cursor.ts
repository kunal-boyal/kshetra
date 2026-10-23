import { SyncEntity } from '@thelamp/shared';
import { z } from 'zod';

/**
 * The pull cursor (spec 11.3, decision D40): base64url JSON, opaque to the phone. It holds, per
 * entity, the transaction horizon its copy is complete up to, and, while a pass runs over several
 * pages, where the pass has got to. Every filter the server applies comes from the caller's
 * access, never from the cursor, so a cursor someone edits can only cost them their own copy.
 */

/** Raise when the cursor's layout changes: every phone takes a full copy of everything. */
export const CURSOR_FORMAT = 1;

const Version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** The last row a pass sent, in (row version, ID) order. */
const After = z.tuple([Version, z.uuid()]);

/** A pass under way: `since` its lower bound, `next` the horizon it moves to once done. */
const Pass = z.object({
  mode: z.enum(['full', 'changes']),
  since: Version,
  next: Version,
  /** When `next` was taken, in seconds since the epoch. */
  nextAt: Version,
  after: After.nullable(),
});

const EntityState = z.object({
  /** The entity's row layout version. */
  version: z.int().nonnegative(),
  /** The caller's scope for the entity when its copy, or the pass under way, began. */
  scope: z.string().max(64),
  /** The copy is complete up to this horizon: every row older than it has been sent. */
  since: Version,
  /** When `since` was taken, in seconds since the epoch. */
  sinceAt: Version,
  pass: Pass.nullable(),
});

const Cursor = z.object({
  format: z.literal(CURSOR_FORMAT),
  tenantId: z.uuid(),
  userId: z.uuid(),
  /** `SYNC_EPOCH` when the cursor was made; raising it sends every phone a full copy. */
  epoch: z.string().max(64),
  entities: z.partialRecord(SyncEntity, EntityState),
});

export type PassState = z.infer<typeof Pass>;
export type EntityState = z.infer<typeof EntityState>;
export type CursorState = z.infer<typeof Cursor>;

export function encodeCursor(cursor: CursorState): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** The cursor, or null when it can't be read: then the phone must start again. */
export function decodeCursor(raw: string): CursorState | null {
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
