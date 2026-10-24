import { Injectable } from '@nestjs/common';
import type { DayLeave } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';

/** Approved leave by person and day, as the leave module knows it (BR-27). */
export interface LeaveDaysSource {
  days(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[],
    from: string,
    to: string,
  ): Promise<Map<string, Map<string, DayLeave>>>;
}

/**
 * Leave in attendance days (BR-23, decision D80): the leave module (step 6, M13) provides who is
 * on approved leave when; until it does, nobody is.
 */
@Injectable()
export class AttendanceLeave {
  private source: LeaveDaysSource | undefined;

  provide(source: LeaveDaysSource): void {
    if (this.source) throw new Error('Leave days are provided already.');
    this.source = source;
  }

  days(tx: TenantTx, tenantId: string, userIds: readonly string[], from: string, to: string) {
    return this.source?.days(tx, tenantId, userIds, from, to) ?? Promise.resolve(new Map());
  }
}
