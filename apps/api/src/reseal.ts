// `pnpm reseal`: seals every secret kept in a column again under the current COLUMN_KEY, after a
// rotation (decision D101, docs/runbooks/secret-rotation.md). Run it with the new key as
// COLUMN_KEY and the old as COLUMN_KEY_PREVIOUS; values sealed under the new key already stay as
// they are, so it may run again. In AWS it runs as a one-off task of the cell's image.
import { createCommandContext, report } from './context';
import { StaffService } from './modules/console/staff.service';
import { SecondFactorService } from './modules/directory/second-factor.service';
import { SsoService } from './modules/directory/sso.service';
import { WebhooksService } from './modules/webhooks/webhooks.service';
import { TenantDirectory } from './platform/planes';

const { app, config } = await createCommandContext();
try {
  const counts = {
    authenticators: await app.get(SecondFactorService).resealSecrets(),
    staff: await app.get(StaffService).resealSecrets(),
    sso: await app.get(SsoService).resealSecrets(),
    webhooks: 0,
  };
  for (const tenantId of await app.get(TenantDirectory).tenantsOn(config.CELL_ID)) {
    counts.webhooks += await app.get(WebhooksService).resealSecrets(tenantId);
  }
  console.log(
    `Sealed again under the current key: ${counts.authenticators} authenticators, ${counts.staff} staff authenticators, ${counts.sso} SSO connections, ${counts.webhooks} webhook secrets.`,
  );
} catch (error) {
  report(error);
} finally {
  await app.close();
}
