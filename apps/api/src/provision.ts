// `pnpm provision`: creates a tenant from an industry template (spec 5.14), with its first admin.
import { parseArgs } from 'node:util';
import { maskPhone, ProvisionTenantInput } from '@kshetra/shared';
import { z } from 'zod';
import { createCommandContext, report } from './context';
import { TenantProvisioner } from './modules/provisioning/provisioner';

const USAGE = `Usage: pnpm provision --name <name> --slug <slug> --template <generic|agri>
                      --admin-name <name> --admin-phone <number>
                      [--admin-code <code>] [--admin-email <email>] [--status trial|active]`;

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    template: { type: 'string' },
    status: { type: 'string' },
    'admin-name': { type: 'string' },
    'admin-phone': { type: 'string' },
    'admin-code': { type: 'string' },
    'admin-email': { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const parsed = ProvisionTenantInput.safeParse({
  name: values.name,
  slug: values.slug,
  template: values.template,
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

const { app } = await createCommandContext();
try {
  const tenant = await app.get(TenantProvisioner).provision(parsed.data);
  console.log(
    `Tenant ${tenant.slug} is ready (${tenant.tenantId}), from the ${parsed.data.template} template.`,
  );
  console.log(
    `Its first admin, ${tenant.admin.name}, signs in with ${maskPhone(tenant.admin.phone!)}.`,
  );
} catch (error) {
  report(error);
} finally {
  await app.close();
}
