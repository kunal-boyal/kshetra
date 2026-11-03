import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../platform/audit';
import { Database } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import {
  type SupportChange,
  SupportNotices,
  type VendorSecondFactorReset,
} from '../../platform/planes';

/**
 * What vendor staff did with a support grant, as the tenant sees it (module M22, decision D93):
 * an audit entry marked with the grant, and for a request, or an emergency entry, an event its
 * admins are notified of. An authenticator vendor staff reset is audited and told the same way.
 */
@Injectable()
export class IamSupportNotices extends SupportNotices {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {
    super();
  }

  async record(tenantId: string, change: SupportChange): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      await this.audit.record(
        tx,
        tenantId,
        { kind: 'platform', id: change.byStaffId, supportGrantId: change.grantId },
        {
          action: change.action,
          target: { type: 'support_grant', id: change.grantId },
          after: {
            staff: change.staffName,
            reason: change.reason,
            scope: change.scope,
            hours: change.hours,
            emergency: change.emergency,
            endsAt: change.endsAt?.toISOString() ?? null,
          },
        },
      );
      if (change.action === 'support.requested' && !change.emergency) {
        await this.outbox.publish(tx, tenantId, 'support.requested', change.grantId, {
          grantId: change.grantId,
          staffName: change.staffName,
          reason: change.reason,
          scope: change.scope,
          hours: change.hours,
          emergency: false,
        });
      }
      if (change.action === 'support.approved' && change.emergency && change.endsAt) {
        await this.outbox.publish(tx, tenantId, 'support.emergency', change.grantId, {
          grantId: change.grantId,
          staffName: change.staffName,
          reason: change.reason,
          endsAt: change.endsAt.toISOString(),
        });
      }
    });
  }

  async secondFactorReset(tenantId: string, reset: VendorSecondFactorReset): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      await this.audit.record(
        tx,
        tenantId,
        { kind: 'platform', id: reset.byStaffId },
        {
          action: 'user.second_factor_reset',
          target: { type: 'user', id: reset.userId },
          after: { removed: reset.removed, staff: reset.staffName, reason: reset.reason },
        },
      );
      await this.outbox.publish(tx, tenantId, 'support.second_factor_reset', reset.userId, {
        userId: reset.userId,
        staffName: reset.staffName,
        reason: reset.reason,
      });
    });
  }
}
