import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  type BillingSettingsBody,
  type BillingSettingsResult,
  GST_STATES,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import type { Config } from '../../config';
import { platformSettings } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { CONFIG } from '../../platform/tokens';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';

const KEY = 'billing';

type Stored = BillingSettingsBody & { example: boolean };

/** Until the vendor saves its own, nothing is set and no invoice can be issued. */
const UNSET: Stored = {
  seller: { legalName: '', gstin: null, address: '', stateCode: '27', email: '', sac: '' },
  invoicePrefix: 'INV',
  gstRate: '18',
  paymentTermsDays: 15,
  graceDays: 7,
  readOnlyDays: 14,
  example: false,
};

/**
 * Fictional seller details for local, test and demo invoices (decision D90), marked so that every
 * invoice drawn on them says it is not a tax invoice. The GSTIN is made up, with a valid check
 * character; the SAC code waits for the vendor's CA.
 */
export const EXAMPLE_BILLING: Stored = {
  seller: {
    legalName: 'Example Field Software Private Limited (fictional)',
    gstin: '27ZZZZZ0000Z1ZQ',
    address: 'Unit 4, Example Business Park, Baner, Pune 411045',
    stateCode: '27',
    email: 'billing@example.com',
    sac: '998314',
  },
  invoicePrefix: 'EX',
  gstRate: '18',
  paymentTermsDays: 15,
  graceDays: 7,
  readOnlyDays: 14,
  example: true,
};

/**
 * Who issues the vendor's invoices, and how unpaid tenants are followed up (module M23, BR-48,
 * decision D90). Kept in `directory.platform_settings` and edited in the console. A live
 * production cell refuses to invoice until real details replace the example.
 */
@Injectable()
export class BillingSettings {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async read(): Promise<Stored> {
    const [row] = await this.database.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, KEY));
    return row ? { ...UNSET, ...(row.value as Partial<Stored>) } : UNSET;
  }

  async result(): Promise<BillingSettingsResult> {
    const stored = await this.read();
    return { ...stored, ready: this.readiness(stored) === null };
  }

  /** What stops invoices being issued now, or null. */
  readiness(stored: Stored): string | null {
    const { seller } = stored;
    if (!seller.legalName || !seller.address || !seller.email || !seller.sac) {
      return 'Set the seller’s details in the console’s billing settings first.';
    }
    const live = this.config.NODE_ENV === 'production' && this.config.CELL_PURPOSE === 'live';
    if (live && (stored.example || !seller.gstin)) {
      return 'Production invoices need the vendor’s own details and GSTIN, not the example.';
    }
    return null;
  }

  /** The settings to invoice with, refused while they aren't ready. */
  async forInvoicing(): Promise<Stored> {
    const stored = await this.read();
    const issue = this.readiness(stored);
    if (issue) throw new AppError('CONFLICT', issue);
    return stored;
  }

  async update(by: StaffAccess, body: BillingSettingsBody): Promise<BillingSettingsResult> {
    await this.database.db.transaction(async (tx) => {
      const before = await this.read();
      // Saving real details ends the example, as the details are now the vendor's own.
      const value: Stored = { ...body, example: false };
      await tx
        .insert(platformSettings)
        .values({ key: KEY, value, updatedBy: by.staffId })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value, updatedAt: new Date(), updatedBy: by.staffId },
        });
      await this.audit.record(tx, by, 'billing.settings_changed', 'platform', KEY, {
        before,
        after: value,
      });
    });
    return this.result();
  }

  /** Puts the fictional details in place where none are set, for the local seed and the demo. */
  async ensureExample(): Promise<void> {
    await this.database.db
      .insert(platformSettings)
      .values({ key: KEY, value: EXAMPLE_BILLING })
      .onConflictDoNothing();
  }
}

/** A party's state as invoices print it. */
export function stateName(code: string): string {
  return GST_STATES[code] ?? code;
}
