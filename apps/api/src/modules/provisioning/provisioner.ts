import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  newId,
  normaliseMobile,
  NUMBER_IN_USE,
  type ProvisionTenantInput,
  type UserResult,
} from '@thelamp/shared';
import { loadTemplate, type Template, TemplateError, validateTemplate } from '@thelamp/templates';
import type { Config } from '../../config';
import { MembershipSync } from '../../platform/planes';
import { CONFIG } from '../../platform/tokens';
import { DirectoryTenants } from '../directory/tenants';
import { CellSetup } from './cell-setup.service';

/** A shared cell is sized for about 20,000 concurrent field users (spec 9.5). */
const SHARED_CELL_CAPACITY = 20_000;

export interface ProvisionedTenant {
  tenantId: string;
  slug: string;
  admin: UserResult;
}

/**
 * Creates a tenant from an industry template (spec 5.14, module M22). The directory registers it
 * closed, its cell sets it up in one transaction, and the `tenant.provisioned` event opens it. A
 * failure part-way leaves a closed tenant, never one people can half use.
 */
@Injectable()
export class TenantProvisioner {
  constructor(
    private readonly directory: DirectoryTenants,
    private readonly cell: CellSetup,
    private readonly members: MembershipSync,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * Creates the tenant from the template named in `input`, or from `file`: a configuration file
   * another tenant exported (decision D66), checked as a template is.
   */
  async provision(
    input: ProvisionTenantInput,
    file?: unknown,
    options: { demo?: boolean; tenantId?: string; trialEndsAt?: Date } = {},
  ): Promise<ProvisionedTenant> {
    const template = file === undefined ? this.template(input.template) : this.fromFile(file);
    // The console names the tenant, so a create sent twice makes one (decision D88).
    const tenantId = options.tenantId ?? newId();
    // Checked before anything is written, so a typo creates nothing.
    const adminPhone = normaliseMobile(input.admin.phone);
    if (!adminPhone) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'admin.phone', issue: 'Use a 10-digit mobile number starting with 6, 7, 8 or 9' },
      ]);
    }
    if ((await this.members.activeElsewhere([adminPhone], tenantId)).has(adminPhone)) {
      throw new AppError('CONFLICT', 'This mobile number is already in use.', [
        { path: 'admin.phone', issue: NUMBER_IN_USE },
      ]);
    }
    if (await this.directory.bySlug(input.slug)) {
      throw new AppError('CONFLICT', 'Another tenant already has this slug.', [
        { path: 'slug', issue: 'Already used by another tenant' },
      ]);
    }

    await this.directory.ensureCell({
      name: this.config.CELL_ID,
      region: this.config.CELL_REGION,
      apiBaseUrl: this.config.CELL_API_URL ?? `http://127.0.0.1:${this.config.PORT}`,
      capacityUsers: SHARED_CELL_CAPACITY,
    });
    await this.directory.register({
      id: tenantId,
      slug: input.slug,
      name: input.name,
      cellName: this.config.CELL_ID,
      templateKey: template.key,
      templateVersion: template.version,
      demo: options.demo ?? false,
      ...(options.trialEndsAt ? { trialEndsAt: options.trialEndsAt } : {}),
    });
    const admin = await this.cell.provision(tenantId, template, input);
    return { tenantId, slug: input.slug, admin };
  }

  private fromFile(file: unknown): Template {
    const checked = validateTemplate(file);
    if (!checked.ok) {
      throw new AppError(
        'VALIDATION',
        'The configuration file has problems.',
        checked.issues.map(({ path, issue }) => ({ path: path ? `file.${path}` : 'file', issue })),
      );
    }
    return checked.template;
  }

  private template(key: string): Template {
    try {
      return loadTemplate(key);
    } catch (error) {
      if (error instanceof TemplateError) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'template', issue: `There is no valid template \`${key}\`` },
        ]);
      }
      throw error;
    }
  }
}
