import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigurationPlan } from '@thelamp/shared';
import { ImportConfigurationBody, TemplateSchema } from '@thelamp/templates';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { ConfigurationService, planRefused, PreviewRollback } from './configuration.service';

/** An import changes every part of the configuration, so it takes every permission over it. */
const IMPORT_PERMISSIONS = [
  'settings.manage',
  'terminology.manage',
  'role.manage',
  'designation.manage',
  'territory.manage',
  'form.manage',
  'metric.manage',
  'catalogue.manage',
] as const;

/** Configuration export and import as JSON (spec 11.2, M2, decision D66). */
@Controller('v1/configuration')
export class ConfigurationController {
  constructor(
    private readonly database: Database,
    private readonly configuration: ConfigurationService,
  ) {}

  @Get('export')
  @Contract({
    tag: 'Configuration',
    summary: "The tenant's configuration as an industry template, to import elsewhere",
    response: TemplateSchema,
  })
  @Requires('settings.manage')
  export(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) => this.configuration.export(tx, access));
  }

  @Post('import/preview')
  @Contract({
    tag: 'Configuration',
    summary: 'What importing a configuration file would add and update, and what stops it',
    body: ImportConfigurationBody,
    response: ConfigurationPlan,
  })
  @Requires(...IMPORT_PERMISSIONS)
  @HttpCode(200)
  async preview(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = ImportConfigurationBody.parse(body);
    try {
      await this.database.forTenant(access.tenantId, async (tx) => {
        throw new PreviewRollback(await this.configuration.apply(tx, access, input.template));
      });
    } catch (error) {
      if (error instanceof PreviewRollback) return error.plan;
      throw error;
    }
    throw new Error('A preview always rolls back.');
  }

  @Post('import')
  @Contract({
    tag: 'Configuration',
    summary: 'Import a configuration file: add and update, never remove',
    body: ImportConfigurationBody,
    response: ConfigurationPlan,
    idempotencyKey: true,
  })
  @Requires(...IMPORT_PERMISSIONS)
  @HttpCode(200)
  async import(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = ImportConfigurationBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/configuration/import', by: access.userId, input },
        async () => {
          const plan = await this.configuration.apply(tx, access, input.template);
          if (plan.issues.length > 0) throw planRefused(plan);
          return { status: 200, body: plan };
        },
      ),
    );
    return result.body;
  }
}
