import { Injectable, Logger } from '@nestjs/common';
import { formatDate, formatMoney, type MessageKey, translate } from '@thelamp/i18n';
import type { Locale } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { billingAccounts, billingNotices, tenants } from '../../db/schema/directory';
import { TenantContacts } from '../../platform/planes';
import { DirectoryDatabase } from '../directory/directory.database';
import { EmailSender, maskEmail } from '../notifications/senders';

export type BillingNotice =
  | 'invoice_issued'
  | 'payment_overdue'
  | 'payment_reminder'
  | 'read_only'
  | 'suspension_soon'
  | 'suspended'
  | 'trial_reminder'
  | 'trial_ended';

export interface NoticeValues {
  amount?: string;
  date?: string;
  number?: string;
  /** For an invoice: whether it is paid automatically. */
  automatic?: boolean;
}

/**
 * Billing's emails (BR-48, decision D90), to the tenant's billing contact and its admins, in the
 * billing contact's language. Each goes once: its key is kept once it has gone, so the hourly job
 * may look as often as it likes, and an email that failed is tried again next time.
 */
@Injectable()
export class BillingNotices {
  private readonly logger = new Logger(BillingNotices.name);

  constructor(
    private readonly database: DirectoryDatabase,
    private readonly contacts: TenantContacts,
    private readonly email: EmailSender,
  ) {}

  async sent(tenantId: string, key: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ key: billingNotices.key })
      .from(billingNotices)
      .where(and(eq(billingNotices.tenantId, tenantId), eq(billingNotices.key, key)));
    return row !== undefined;
  }

  /** Marks notices as sent without sending them, as when a later notice supersedes them. */
  async skip(tenantId: string, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.database.db
      .insert(billingNotices)
      .values(keys.map((key) => ({ tenantId, key })))
      .onConflictDoNothing();
  }

  async send(
    tenantId: string,
    key: string,
    notice: BillingNotice,
    values: NoticeValues,
  ): Promise<void> {
    if (await this.sent(tenantId, key)) return;
    const [tenant] = await this.database.db
      .select({ name: tenants.name, account: billingAccounts })
      .from(tenants)
      .leftJoin(billingAccounts, eq(billingAccounts.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId));
    if (!tenant) return;
    const locale = (tenant.account?.language ?? 'en') as Locale;
    const params = {
      organisation: tenant.name,
      amount: values.amount ? formatMoney(values.amount as `${number}`, { locale }) : '',
      date: values.date ? formatDate(values.date, { locale }) : '',
      number: values.number ?? '',
      payment: translate(
        values.automatic ? 'billing.notice_paid_automatically' : 'billing.notice_pay_by_transfer',
        { locale },
      ),
    };
    const text = (part: 'subject' | 'body') =>
      translate(`billing.notice_${notice}_${part}` as MessageKey, { locale, params });
    const to = new Set<string>();
    if (tenant.account) to.add(tenant.account.email.toLowerCase());
    for (const admin of await this.contacts.admins(tenantId)) to.add(admin.email.toLowerCase());
    for (const address of to) {
      const result = await this.email.send({
        to: address,
        subject: text('subject'),
        text: text('body'),
      });
      if (!result.ok) {
        this.logger.warn(`Billing notice ${notice} to ${maskEmail(address)} failed`);
        return;
      }
    }
    await this.skip(tenantId, [key]);
  }
}
