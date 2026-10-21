import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import {
  AppError,
  ReviewRulesResult,
  TenantSettings,
  TerminologyOverrides,
  TerminologyResult,
  UpdateReviewRulesBody,
  UpdateSettingsBody,
} from '@kshetra/shared';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { TenantConfigService } from './tenant-config.service';

/**
 * Tenant settings and terminology (spec 5.1, 5.2). Changes reach every app with its next config
 * fetch, with no release (module M2). Both requests are idempotent by themselves.
 */
@Controller('v1')
export class SettingsController {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
  ) {}

  @Patch('settings')
  @Contract({
    tag: 'Settings',
    summary: "Change the tenant's settings",
    body: UpdateSettingsBody,
    response: TenantSettings,
  })
  @Requires('settings.manage')
  updateSettings(@CurrentAccess() access: Access, @Body() body: unknown): Promise<TenantSettings> {
    const patch = UpdateSettingsBody.parse(body);
    // Switching modules is its own permission (spec Appendix E).
    if (patch.modulesOff && !access.permissions.has('module.manage')) {
      throw new AppError('FORBIDDEN', 'You cannot switch modules on or off.');
    }
    return this.database.forTenant(access.tenantId, (tx) =>
      this.config.updateSettings(tx, access.tenantId, userActor(access), patch),
    );
  }

  @Get('review-rules')
  @Contract({
    tag: 'Settings',
    summary: "The tenant's review rules: auto-approval and its delay",
    response: ReviewRulesResult,
  })
  @RequiresAny('review_rules.manage', 'submission.review')
  reviewRules(@CurrentAccess() access: Access): Promise<ReviewRulesResult> {
    return this.database.forTenant(access.tenantId, (tx) =>
      this.config.reviewRules(tx, access.tenantId),
    );
  }

  @Put('review-rules')
  @Contract({
    tag: 'Settings',
    summary: "Set the tenant's review rules",
    body: UpdateReviewRulesBody,
    response: ReviewRulesResult,
  })
  @Requires('review_rules.manage')
  updateReviewRules(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
  ): Promise<ReviewRulesResult> {
    const input = UpdateReviewRulesBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.config.updateReviewRules(tx, access.tenantId, userActor(access), input),
    );
  }

  @Get('terminology')
  @Contract({ tag: 'Settings', summary: "The tenant's own words", response: TerminologyResult })
  @Requires('terminology.manage')
  async terminology(@CurrentAccess() access: Access): Promise<TerminologyResult> {
    const overrides = await this.database.forTenant(access.tenantId, (tx) =>
      this.config.terminology(tx, access.tenantId),
    );
    return { overrides };
  }

  @Put('terminology')
  @Contract({
    tag: 'Settings',
    summary: "Replace the tenant's own words",
    body: TerminologyOverrides,
    response: TerminologyResult,
  })
  @Requires('terminology.manage')
  async replaceTerminology(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
  ): Promise<TerminologyResult> {
    const input = TerminologyOverrides.parse(body);
    const overrides = await this.database.forTenant(access.tenantId, (tx) =>
      this.config.replaceTerminology(tx, access.tenantId, userActor(access), input),
    );
    return { overrides };
  }
}
