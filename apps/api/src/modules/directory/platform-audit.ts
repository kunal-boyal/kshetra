import { Injectable } from '@nestjs/common';
import { newId } from '@thelamp/shared';
import { platformAudit } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import type { DirectoryTx } from './directory.database';

/**
 * What vendor staff did in the console (spec 13.2, decision D88), written in the transaction of
 * the change. `by` is null for the command line and for a person setting up or signing in, who is
 * named by the target instead.
 */
@Injectable()
export class PlatformAudit {
  async record(
    tx: DirectoryTx,
    by: StaffAccess | null,
    action: string,
    targetType: string,
    targetId: string,
    detail: Record<string, unknown>,
    ip?: string,
  ): Promise<void> {
    await tx.insert(platformAudit).values({
      id: newId(),
      platformUserId: by?.staffId ?? null,
      action,
      targetType,
      targetId,
      detail,
      ip: ip ?? by?.ip ?? null,
    });
  }
}
