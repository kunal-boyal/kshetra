import { Injectable, type OnModuleInit } from '@nestjs/common';
import { recordCutoffs } from '@thelamp/shared';
import { AuditLog, SYSTEM_ACTOR } from '../../platform/audit';
import { Database } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { ImportsService } from '../imports/imports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

const KIND = 'governance.retention';

/**
 * Retention for the records the tenant chooses how long to keep (BR-41, decision D95): its
 * notifications, uploaded import files and audit log, removed each night past the keeping times in
 * its settings by the modules that own them. Each run that removes something is in the audit log.
 */
@Injectable()
export class RecordRetention implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly notifications: NotificationsService,
    private readonly imports: ImportsService,
    private readonly audit: AuditLog,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', KIND, async (data) => {
      await this.apply(String(data.tenantId));
    });
    this.schedules.atTenantTime({
      name: 'governance',
      at: '01:30',
      queue: 'maintenance',
      kind: KIND,
    });
  }

  /** One tenant's run; running it again the same night finds nothing more to remove. */
  async apply(
    tenantId: string,
    now = new Date(),
  ): Promise<{ notifications: number; importFiles: number; audit: number }> {
    return this.database.forTenant(tenantId, async (tx) => {
      const cutoffs = recordCutoffs(await this.config.settings(tx, tenantId), now);
      const removed = {
        notifications: await this.notifications.removeOlderThan(
          tx,
          tenantId,
          cutoffs.notifications,
        ),
        importFiles: await this.imports.expireFiles(tx, tenantId, cutoffs.importFiles),
        audit: await this.audit.purgeBefore(tx, tenantId, cutoffs.audit),
      };
      for (const [name, deleted] of Object.entries(removed)) {
        if (deleted === 0) continue;
        await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
          action: 'retention.applied',
          target: {
            type:
              name === 'audit' ? 'audit_log' : name === 'importFiles' ? 'import' : 'notification',
            id: null,
          },
          after: {
            class: name,
            deleted,
            before: cutoffs[name as keyof typeof cutoffs].toISOString(),
          },
        });
      }
      return removed;
    });
  }
}
