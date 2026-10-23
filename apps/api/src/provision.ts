// `pnpm provision`: creates a tenant from an industry template (spec 5.14), or from a configuration
// file another tenant exported (decision D66), with its first admin.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { maskPhone, ProvisionTenantInput, UpdateSettingsBody } from '@thelamp/shared';
import { z } from 'zod';
import { createCommandContext, report } from './context';
import { TenantProvisioner } from './modules/provisioning/provisioner';
import { OrganisationService } from './modules/tenant-config/organisation.service';
import { TenantConfigService } from './modules/tenant-config/tenant-config.service';
import { userActor } from './platform/audit';
import { AccessResolver } from './platform/auth';
import { Database } from './platform/database';

const USAGE = `Usage: pnpm provision --name <name> --slug <slug> (--template <generic|agri> | --file <path>)
                      --admin-name <name> --admin-phone <number>
                      [--admin-code <code>] [--admin-email <email>] [--status trial|active]
                      [--demo]   a tenant for showing the product: its people may sign in with
                                 the fixed codes in DEMO_CODES (decision D70)
                      [--logo <png|jpg|webp>] [--brand-colour <#rrggbb>]
                                 the tenant's logo and brand colour, checked as Settings checks them`;

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    template: { type: 'string' },
    file: { type: 'string' },
    status: { type: 'string' },
    'admin-name': { type: 'string' },
    'admin-phone': { type: 'string' },
    'admin-code': { type: 'string' },
    'admin-email': { type: 'string' },
    demo: { type: 'boolean', default: false },
    logo: { type: 'string' },
    'brand-colour': { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

let file: unknown;
if (values.file) {
  try {
    file = JSON.parse(readFileSync(values.file, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${values.file} as JSON: ${(error as Error).message}`);
    process.exit(1);
  }
}

const parsed = ProvisionTenantInput.safeParse({
  name: values.name,
  slug: values.slug,
  template:
    values.template ??
    (typeof file === 'object' && file !== null ? (file as { key?: unknown }).key : undefined),
  ...(values.status ? { status: values.status } : {}),
  admin: {
    name: values['admin-name'],
    phone: values['admin-phone'],
    ...(values['admin-code'] ? { code: values['admin-code'] } : {}),
    ...(values['admin-email'] ? { email: values['admin-email'] } : {}),
  },
});
if (!parsed.success) {
  console.error(z.prettifyError(parsed.error));
  console.error(USAGE);
  process.exit(1);
}
// Checked before anything is made, as a typo should make nothing.
const brand = values['brand-colour']
  ? UpdateSettingsBody.safeParse({ brandColour: values['brand-colour'] })
  : undefined;
if (brand && !brand.success) {
  console.error(z.prettifyError(brand.error));
  process.exit(1);
}
const LOGO_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
let logo: { contentType: string; bytes: Uint8Array } | undefined;
if (values.logo) {
  const contentType = LOGO_TYPES[extname(values.logo).toLowerCase()];
  if (!contentType) {
    console.error('Use a PNG, JPEG or WebP file for the logo.');
    process.exit(1);
  }
  try {
    logo = { contentType, bytes: new Uint8Array(readFileSync(values.logo)) };
  } catch (error) {
    console.error(`Could not read ${values.logo}: ${(error as Error).message}`);
    process.exit(1);
  }
}

const { app, config } = await createCommandContext();
try {
  const tenant = await app
    .get(TenantProvisioner)
    .provision(parsed.data, file, { demo: values.demo ?? false });
  if (brand || logo) {
    // As the first admin would set them in Settings, so the same checks and audit apply.
    const access = await app
      .get(AccessResolver)
      .onBehalfOf(tenant.tenantId, tenant.admin.id, config.CELL_ID);
    await app.get(Database).forTenant(tenant.tenantId, async (tx) => {
      if (brand?.data) {
        await app
          .get(TenantConfigService)
          .updateSettings(tx, tenant.tenantId, userActor(access), brand.data);
      }
      if (logo) {
        await app.get(OrganisationService).setLogo(tx, access, logo.contentType, logo.bytes);
      }
    });
  }
  const source = values.file ?? `the ${parsed.data.template} template`;
  console.log(
    `${values.demo ? 'Demo tenant' : 'Tenant'} ${tenant.slug} is ready (${tenant.tenantId}), from ${source}.`,
  );
  console.log(
    `Its first admin, ${tenant.admin.name}, signs in with ${maskPhone(tenant.admin.phone!)}.`,
  );
} catch (error) {
  report(error);
} finally {
  await app.close();
}
