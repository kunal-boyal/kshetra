import { Injectable } from '@nestjs/common';
import {
  LOCALES,
  type TenantSettings,
  TerminologyOverrides,
  type TermValue,
  type UpdateSettingsBody,
  withDefaults,
} from '@kshetra/shared';
import { eq, sql } from 'drizzle-orm';
import { tenantSettings, terminologyOverrides } from '../../db/schema/tenant-config';
import type { TenantTx } from '../../platform/database';

/**
 * A tenant's settings (spec 5.1), its words (spec 5.2), and the config version that moves on with
 * every change to anything in the config bundle, whichever module made it.
 */
@Injectable()
export class TenantConfigService {
  /** The tenant's settings, defaults filled in. */
  async settings(tx: TenantTx, tenantId: string): Promise<TenantSettings> {
    const [row] = await tx
      .select({ settings: tenantSettings.settings })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    return withDefaults(row?.settings ?? {});
  }

  /** The config version; 0 for a tenant whose configuration never changed. */
  async version(tx: TenantTx, tenantId: string): Promise<number> {
    const [row] = await tx
      .select({ version: tenantSettings.configVersion })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    return row?.version ?? 0;
  }

  /** Moves the config version on. Every change to what the config bundle holds calls it. */
  async touch(tx: TenantTx, tenantId: string, actorId: string | null): Promise<void> {
    await tx
      .insert(tenantSettings)
      .values({ tenantId, updatedBy: actorId })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          configVersion: sql`${tenantSettings.configVersion} + 1`,
          updatedAt: sql`now()`,
          updatedBy: actorId,
        },
      });
  }

  /** Changes some settings. The result must still be valid as a whole. */
  async updateSettings(
    tx: TenantTx,
    tenantId: string,
    actorId: string,
    patch: UpdateSettingsBody,
  ): Promise<TenantSettings> {
    const [row] = await tx
      .select({ settings: tenantSettings.settings })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .for('update');
    const changed = { ...row?.settings, ...patch };
    const settings = withDefaults(changed);
    await tx
      .insert(tenantSettings)
      .values({ tenantId, settings: changed, updatedBy: actorId })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          settings: changed,
          configVersion: sql`${tenantSettings.configVersion} + 1`,
          updatedAt: sql`now()`,
          updatedBy: actorId,
        },
      });
    return settings;
  }

  /** The tenant's own words, by term; terms without one keep the product's. */
  async terminology(tx: TenantTx, tenantId: string): Promise<TerminologyOverrides> {
    const rows = await tx
      .select({
        key: terminologyOverrides.key,
        locale: terminologyOverrides.locale,
        value: terminologyOverrides.value,
      })
      .from(terminologyOverrides)
      .where(eq(terminologyOverrides.tenantId, tenantId));
    const byKey: Record<string, Record<string, TermValue>> = {};
    for (const row of rows) (byKey[row.key] ??= {})[row.locale] = row.value;
    return TerminologyOverrides.parse(byKey);
  }

  /**
   * Replaces the tenant's words as a whole: a term left out goes back to the product's word. The
   * rows are configuration, not records, so the old ones go; the audit log (module M21) is where
   * a change like this one is kept.
   */
  async replaceTerminology(
    tx: TenantTx,
    tenantId: string,
    actorId: string | null,
    overrides: TerminologyOverrides,
  ): Promise<TerminologyOverrides> {
    await tx.delete(terminologyOverrides).where(eq(terminologyOverrides.tenantId, tenantId));
    const rows = Object.entries(overrides).flatMap(([key, value]) =>
      value ? LOCALES.map((locale) => ({ tenantId, key, locale, value: value[locale] })) : [],
    );
    if (rows.length > 0) await tx.insert(terminologyOverrides).values(rows);
    await this.touch(tx, tenantId, actorId);
    return this.terminology(tx, tenantId);
  }

  /** A new tenant's settings row and its template's words (spec 5.14). */
  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    template: { terminology: TerminologyOverrides },
  ): Promise<void> {
    await this.replaceTerminology(tx, tenantId, null, template.terminology);
  }
}
