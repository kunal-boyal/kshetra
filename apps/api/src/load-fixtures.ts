// `pnpm --filter @thelamp/api load:fixtures`: a fictional tenant for the k6 load tests (spec 14.4,
// decision D68), with a manager and field users already signed in on their own devices, written
// to a file the k6 scripts read. Local databases only, as the seed is.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { FormDefinition } from '@thelamp/forms';
import { CreateUserBody, todayIn } from '@thelamp/shared';
import { createCommandContext, report } from './context';
import { isLocalDatabase } from './db/bootstrap';
import { SessionsService } from './modules/directory/sessions.service';
import { SYSTEM } from './modules/iam/actor';
import { UsersService } from './modules/iam/users.service';
import { FormsService } from './modules/forms/forms.service';
import { TenantProvisioner } from './modules/provisioning/provisioner';
import { AccessResolver } from './platform/auth';
import { Database } from './platform/database';

const { values } = parseArgs({
  options: {
    users: { type: 'string', default: '50' },
    out: { type: 'string', default: '../../tools/k6/.fixtures/local.json' },
  },
});
const count = Number(values.users);
if (!Number.isInteger(count) || count < 1 || count > 20_000) {
  console.error('Use --users with a number from 1 to 20000.');
  process.exit(1);
}

const { app, config } = await createCommandContext();
try {
  if (!isLocalDatabase(config.DATABASE_URL)) {
    throw new Error('Load fixtures are made on a local database only.');
  }
  // Fictional numbers in a block no seed uses, different on every run.
  const run = randomBytes(2).readUInt16BE() % 1000;
  const phone = (index: number) =>
    `+917${String(run).padStart(3, '0')}${String(index).padStart(6, '0')}`;
  const slug = `load-${run}-${Date.now().toString(36)}`;
  const { tenantId, admin } = await app.get(TenantProvisioner).provision({
    name: `Load Test ${run}`,
    slug,
    template: 'generic',
    status: 'active',
    admin: { code: 'ADMIN-1', name: 'Load Admin', phone: phone(0) },
  });

  const users = app.get(UsersService);
  const made = await app.get(Database).forTenant(tenantId, async (tx) => {
    const manager = await users.create(
      tx,
      tenantId,
      SYSTEM,
      CreateUserBody.parse({
        code: 'MGR-1',
        name: 'Load Manager',
        phone: phone(1),
        designation: 'manager',
        role: 'manager',
      }),
    );
    const field: string[] = [];
    for (let index = 0; index < count; index++) {
      await users.create(
        tx,
        tenantId,
        SYSTEM,
        CreateUserBody.parse({
          code: `FU-${index + 1}`,
          name: `Field User ${index + 1}`,
          phone: phone(index + 2),
          designation: 'executive',
          role: 'field_user',
          managerId: manager.id,
        }),
      );
      field.push(phone(index + 2));
    }
    return { manager: phone(1), field };
  });

  // A form without photos, so the submissions test measures submissions, not uploads.
  const access = await app.get(AccessResolver).onBehalfOf(tenantId, admin.id, config.CELL_ID);
  await app.get(Database).forTenant(tenantId, (tx) =>
    app.get(FormsService).create(
      tx,
      access,
      FormDefinition.parse({
        key: 'load_note',
        name: {
          en: { one: 'Load note', other: 'Load notes' },
          hi: { one: 'Load note', other: 'Load notes' },
        },
        icon: 'clipboard-check',
        accountLink: { mode: 'none' },
        shift: 'required',
        review: 'manual',
        geofence: 'off',
        signature: 'none',
        photos: { min: 0, max: 1, source: 'camera' },
        fields: [{ key: 'note', type: 'short_text', label: { en: 'Note', hi: 'Note' } }],
      }),
    ),
  );

  // Each person signs in on a phone of their own, as the app would after a code.
  const sessions = app.get(SessionsService);
  const signIn = async (number: string) => {
    const result = await sessions.signIn(number, {
      key: randomBytes(32).toString('base64url'),
      platform: 'android',
      model: 'k6',
    });
    if (result.status !== 'signed_in') throw new Error('A load user did not sign straight in.');
    // Only the refresh token: k6 spends it at the running API for an access token, which this
    // process, with its own signing key, can't issue for it.
    return { refreshToken: result.session.refreshToken! };
  };
  const fixtures = {
    tenantId,
    period: todayIn('Asia/Kolkata').slice(0, 7),
    manager: await signIn(made.manager),
    fieldUsers: [] as { refreshToken: string }[],
  };
  for (const number of made.field) fixtures.fieldUsers.push(await signIn(number));

  mkdirSync(dirname(values.out!), { recursive: true });
  writeFileSync(values.out!, JSON.stringify(fixtures));
  console.log(`Tenant ${slug} has ${count} field users; their sessions are in ${values.out}.`);
} catch (error) {
  report(error);
} finally {
  await app.close();
}
