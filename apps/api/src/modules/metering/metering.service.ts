import { Injectable, type OnModuleInit } from '@nestjs/common';
import { billableSeats, periodDays, todayIn, type UsageMetric } from '@thelamp/shared';
import { ApiCalls } from '../../platform/api-calls';
import { Database } from '../../platform/database';
import { UsageRecorder } from '../../platform/planes';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { startOfLocalDate } from '../../platform/local-day';
import { Seats } from '../iam/seats';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** How often each tenant's month is measured again. */
export const METERING_EVERY_MS = 60 * 60_000;
/** Into a new month, last month is measured again for these many days, so late changes land. */
const SETTLE_DAYS = 3;

/**
 * The cell's half of metered usage (M22, decision D89): for one tenant's month on its own clock,
 * billable seats by BR-45, storage kept, SMS and WhatsApp messages sent, and API calls, sent to
 * the directory, which adds the people who signed in. It runs every hour for each open tenant.
 */
@Injectable()
export class MeteringService implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly seats: Seats,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly apiCalls: ApiCalls,
    private readonly recorder: UsageRecorder,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.schedules.everyForTenants({
      name: 'billing_usage',
      everyMs: METERING_EVERY_MS,
      queue: 'maintenance',
      kind: 'billing.usage',
    });
    this.queues.handle('maintenance', 'billing.usage', (data) => this.meter(String(data.tenantId)));
  }

  /** This month, and last month too in a new month's first days. */
  async meter(tenantId: string, now = new Date()): Promise<void> {
    const { timezone } = await this.database.forTenant(tenantId, (tx) =>
      this.config.settings(tx, tenantId),
    );
    const today = todayIn(timezone, now);
    const periods = [today.slice(0, 7)];
    if (Number(today.slice(8, 10)) <= SETTLE_DAYS) {
      const [year, month] = today.split('-').map(Number) as [number, number];
      periods.push(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7));
    }
    for (const period of periods) {
      await this.recorder.record(tenantId, period, await this.measure(tenantId, period, timezone));
    }
  }

  /** One month's usage, measured from the cell's records. */
  async measure(
    tenantId: string,
    period: string,
    timezone: string,
  ): Promise<Partial<Record<UsageMetric, string>>> {
    const { start, end } = periodDays(period);
    const from = startOfLocalDate(start, timezone);
    const next = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const to = startOfLocalDate(next, timezone);
    return this.database.forTenant(tenantId, async (tx) => {
      const intervals = await this.seats.during(tx, tenantId, from, to);
      const seats = billableSeats(
        intervals.map((interval) => ({
          userId: interval.userId,
          from: todayIn(timezone, interval.activeFrom),
          to: interval.activeTo ? todayIn(timezone, interval.activeTo) : null,
        })),
        start,
        end,
      );
      return {
        seats: seats.units,
        storage_bytes: String(await this.media.storedBytes(tx, tenantId)),
        sms: String(await this.notifications.sentCount(tx, tenantId, 'sms', from, to)),
        whatsapp: String(await this.notifications.sentCount(tx, tenantId, 'whatsapp', from, to)),
        api_calls: String(await this.apiCalls.read(tenantId, period)),
      };
    });
  }
}
