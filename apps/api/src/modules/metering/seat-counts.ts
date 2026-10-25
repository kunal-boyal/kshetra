import { Injectable } from '@nestjs/common';
import { addDays, type BillableSeats, billableSeats, todayIn } from '@thelamp/shared';
import { Database, type TenantTx } from '../../platform/database';
import { startOfLocalDate } from '../../platform/local-day';
import { SeatCounts } from '../../platform/planes';
import { Seats } from '../iam/seats';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/**
 * Billable seats for some days on the tenant's clock (BR-45), from its people's active stretches.
 * `billedFrom` starts billing later than the period, as a subscription that starts mid-month does:
 * people active before it count from that day.
 */
export async function countSeats(
  tx: TenantTx,
  seats: Seats,
  input: {
    tenantId: string;
    from: string;
    to: string;
    timezone: string;
    prorate: boolean;
    billedFrom?: string;
  },
): Promise<BillableSeats> {
  const start = input.billedFrom && input.billedFrom > input.from ? input.billedFrom : input.from;
  const intervals = await seats.during(
    tx,
    input.tenantId,
    startOfLocalDate(start, input.timezone),
    startOfLocalDate(addDays(input.to, 1), input.timezone),
  );
  return billableSeats(
    intervals.map((interval) => {
      const from = todayIn(input.timezone, interval.activeFrom);
      return {
        userId: interval.userId,
        from: from < start ? start : from,
        to: interval.activeTo ? todayIn(input.timezone, interval.activeTo) : null,
      };
    }),
    input.from,
    input.to,
    input.prorate,
  );
}

/** The cell's answer to the directory's invoices (decision D90). */
@Injectable()
export class CellSeatCounts extends SeatCounts {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly seats: Seats,
  ) {
    super();
  }

  active(tenantId: string): Promise<number> {
    return this.database.forTenant(tenantId, (tx) => this.seats.active(tx, tenantId));
  }

  billable(
    tenantId: string,
    from: string,
    to: string,
    prorate: boolean,
    billedFrom?: string,
  ): Promise<BillableSeats> {
    return this.database.forTenant(tenantId, async (tx) => {
      const { timezone } = await this.config.settings(tx, tenantId);
      return countSeats(tx, this.seats, {
        tenantId,
        from,
        to,
        timezone,
        prorate,
        ...(billedFrom ? { billedFrom } : {}),
      });
    });
  }
}
