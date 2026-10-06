import { AppError } from '@kshetra/shared';
import { and, eq } from 'drizzle-orm';
import { idempotencyKeys, type StoredResponse } from '../db/schema';
import { hashRequest } from './canonical-json';
import type { TenantTx } from './database';

export interface IdempotentResult extends StoredResponse {
  /** True when this is the stored result of an earlier request with the same key. */
  replayed: boolean;
}

const KEY = /^[\x21-\x7e]{1,200}$/;

/**
 * Runs `handler` once per idempotency key (BR-46).
 * - The same key with the same content returns the stored result without running `handler` again.
 * - The same key with different content fails with IDEMPOTENCY_CONFLICT.
 *
 * Content is compared by a hash of the canonical request body. Call it inside `Database.forTenant`.
 * Claiming the key and storing the result happen in that one transaction, so a concurrent request
 * with the same key waits for the first to commit and then replays it; if the first rolls back, the
 * key is free again.
 */
export async function idempotent(
  tx: TenantTx,
  tenantId: string,
  key: string,
  request: unknown,
  handler: () => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  if (!KEY.test(key)) {
    throw new AppError('VALIDATION', 'The idempotency key must be 1 to 200 visible characters.', [
      { path: 'Idempotency-Key', issue: 'Use 1 to 200 visible ASCII characters' },
    ]);
  }
  const requestHash = hashRequest(request);
  const where = and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key));

  const claimed = await tx
    .insert(idempotencyKeys)
    .values({ tenantId, key, requestHash })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (claimed.length === 1) {
    const response = await handler();
    await tx.update(idempotencyKeys).set({ response }).where(where);
    return { ...response, replayed: false };
  }

  const [existing] = await tx
    .select({ requestHash: idempotencyKeys.requestHash, response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(where);
  if (existing === undefined) {
    throw new Error('An idempotency key conflicted but could not be read back.');
  }
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      'This key was already used for a request with different content. Send a new request with a new key.',
    );
  }
  if (existing.response === null) {
    throw new AppError(
      'CONFLICT',
      'The first request with this key is still being processed. Try again shortly.',
    );
  }
  return { ...existing.response, replayed: true };
}

/**
 * The `Idempotency-Key` header that creates and actions without a client-generated ID carry
 * (spec 11.1, BR-46).
 */
export function requireIdempotencyKey(header: string | undefined): string {
  if (!header) {
    throw new AppError('VALIDATION', 'Send an Idempotency-Key header with this request.', [
      { path: 'Idempotency-Key', issue: 'Required: a new random value for each change' },
    ]);
  }
  return header;
}
