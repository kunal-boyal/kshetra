import { Injectable } from '@nestjs/common';
import {
  AppError,
  deriveAccent,
  AUTO_APPROVAL_DELAY_HOURS,
  LOCALES,
  type ReviewRulesResult,
  SWITCHABLE_MODULES,
  type SwitchableModule,
  type TenantSettings,
  TerminologyOverrides,
  type TermValue,
  type UpdateReviewRulesBody,
  withDefaults,
} from '@thelamp/shared';
import { eq, sql } from 'drizzle-orm';
import { reviewRules, tenantSettings, terminologyOverrides } from '../../db/schema/tenant-config';
import { type AuditActor, AuditLog, SYSTEM_ACTOR } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { Entitlements } from '../../platform/planes';

/**
 * A tenant's settings (spec 5.1), its words (spec 5.2), and the config version that moves on with
 * every change to anything in the config bundle, whichever module made it.
 */
@Injectable()
export class TenantConfigService {
  constructor(
    private readonly audit: AuditLog,
    private readonly entitlements: Entitlements,
  ) {}

  /**
   * The modules the tenant's plan leaves out (spec 5.13, decision D89). They count as switched off
   * wherever settings are read, so their routes, phone copies and screens close as an admin's
   * switch closes them; without a plan, none are left out.
   */
  private async outsidePlan(tenantId: string): Promise<SwitchableModule[]> {
    const { modules } = await this.entitlements.forTenant(tenantId);
    return modules ? SWITCHABLE_MODULES.filter((module) => !modules.includes(module)) : [];
  }

  /** Settings as everyone reads them: the admin's switched-off modules, and those outside the plan. */
  private async effective(tenantId: string, stored: TenantSettings): Promise<TenantSettings> {
    const outside = await this.outsidePlan(tenantId);
    if (outside.length === 0) return stored;
    return { ...stored, modulesOff: [...new Set([...stored.modulesOff, ...outside])] };
  }

  /** The tenant's settings, defaults filled in. */
  async settings(tx: TenantTx, tenantId: string): Promise<TenantSettings> {
    const [row] = await tx
      .select({ settings: tenantSettings.settings })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    return this.effective(tenantId, withDefaults(row?.settings ?? {}));
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
    actor: AuditActor,
    patch: Partial<TenantSettings>,
  ): Promise<TenantSettings> {
    const actorId = actor.id;
    const [row] = await tx
      .select({ settings: tenantSettings.settings })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .for('update');
    const before = await this.effective(tenantId, withDefaults(row?.settings ?? {}));
    const changed = { ...row?.settings, ...patch };
    if (patch.modulesOff) {
      // A module outside the plan can't be switched on, and only the admin's own choices are kept.
      const outside = await this.outsidePlan(tenantId);
      const opened = outside.filter((module) => !patch.modulesOff!.includes(module));
      if (opened.length > 0) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'modulesOff', issue: `Your plan does not include ${opened.join(', ')}` },
        ]);
      }
      changed.modulesOff = patch.modulesOff.filter((module) => !outside.includes(module));
    }
    const settings = await this.effective(tenantId, withDefaults(changed));
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
    // A new brand colour notes which derived tokens had to move to pass (tenant-theming.md).
    const accentAdjusted =
      patch.brandColour && patch.brandColour !== before.brandColour
        ? deriveAccent(patch.brandColour).adjusted
        : undefined;
    await this.audit.record(tx, tenantId, actor, {
      action: 'settings.updated',
      target: { type: 'tenant', id: tenantId },
      before,
      after: accentAdjusted ? { ...settings, accentAdjusted } : settings,
    });
    return settings;
  }

  /** The tenant's review rules (M7): the auto-approval switch and how long it waits. */
  async reviewRules(tx: TenantTx, tenantId: string): Promise<ReviewRulesResult> {
    const [row] = await tx
      .select({ rules: reviewRules.rules })
      .from(reviewRules)
      .where(eq(reviewRules.tenantId, tenantId));
    const { reviewAutoApproval } = await this.settings(tx, tenantId);
    return {
      autoApproval: reviewAutoApproval,
      delayHours: row?.rules.delayHours ?? AUTO_APPROVAL_DELAY_HOURS,
    };
  }

  /**
   * Sets the review rules. The delay applies to submissions that arrive from now on; those already
   * waiting keep the time they were given.
   */
  async updateReviewRules(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    body: UpdateReviewRulesBody,
  ): Promise<ReviewRulesResult> {
    const before = await this.reviewRules(tx, tenantId);
    if (before.autoApproval !== body.autoApproval) {
      await this.updateSettings(tx, tenantId, actor, { reviewAutoApproval: body.autoApproval });
    }
    await tx
      .insert(reviewRules)
      .values({ tenantId, rules: { delayHours: body.delayHours }, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: reviewRules.tenantId,
        set: { rules: { delayHours: body.delayHours }, updatedAt: sql`now()`, updatedBy: actor.id },
      });
    const after = { autoApproval: body.autoApproval, delayHours: body.delayHours };
    await this.audit.record(tx, tenantId, actor, {
      action: 'review_rules.updated',
      target: { type: 'tenant', id: tenantId },
      before,
      after,
    });
    return after;
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
   * rows are configuration, not records, so the old ones go; the audit log keeps them.
   */
  async replaceTerminology(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    overrides: TerminologyOverrides,
  ): Promise<TerminologyOverrides> {
    const before = await this.terminology(tx, tenantId);
    await tx.delete(terminologyOverrides).where(eq(terminologyOverrides.tenantId, tenantId));
    const rows = Object.entries(overrides).flatMap(([key, value]) =>
      value ? LOCALES.map((locale) => ({ tenantId, key, locale, value: value[locale] })) : [],
    );
    if (rows.length > 0) await tx.insert(terminologyOverrides).values(rows);
    await this.touch(tx, tenantId, actor.id);
    const after = await this.terminology(tx, tenantId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'terminology.replaced',
      target: { type: 'tenant', id: tenantId },
      before,
      after,
    });
    return after;
  }

  /** A new tenant's settings row and its template's words (spec 5.14). */
  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    template: { terminology: TerminologyOverrides },
  ): Promise<void> {
    await this.replaceTerminology(tx, tenantId, SYSTEM_ACTOR, template.terminology);
  }
}
