import {
  LOCAL_ENTITIES,
  type Outbox,
  type SqlDatabase,
  type SyncRunner,
} from '@thelamp/api-client/sync';
import type { CreateAccountBody, SyncAccount } from '@thelamp/shared';
import type { LocationProposalPayload } from './outbox-kinds';

interface Ready {
  db: SqlDatabase;
  outbox: Outbox;
  runner: SyncRunner;
}

/**
 * A new account proposed from the field (M4, decision D38): kept on the phone as pending, so the
 * person sees it at once, and queued for upload in the same transaction (spec 11.3). The next
 * sync replaces the local copy with the server's.
 */
export async function proposeAccount(
  sync: Ready,
  owner: string,
  body: CreateAccountBody,
  preview: SyncAccount,
): Promise<void> {
  await sync.db.transaction(async (tx) => {
    const columns = LOCAL_ENTITIES.accounts.columns(preview);
    const names = Object.keys(columns);
    await tx.run(
      `INSERT OR REPLACE INTO ref_accounts (${names.join(', ')}, sync_gen)
       VALUES (${names.map(() => '?').join(', ')}, 0)`,
      Object.values(columns),
    );
    await sync.outbox.enqueue(tx, { id: body.id, owner, kind: 'account.propose', payload: body });
  });
  await sync.runner.refresh();
  void sync.runner.sync();
}

/** A location proposed standing at an account, queued for upload (M4). */
export async function proposeLocation(
  sync: Ready,
  owner: string,
  payload: LocationProposalPayload,
): Promise<void> {
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, {
      id: payload.id,
      owner,
      kind: 'account.location',
      payload,
      // A location for an account proposed on this phone waits for that account to arrive.
      dependsOn: [payload.accountId],
    });
  });
  await sync.runner.refresh();
  void sync.runner.sync();
}
