// `pnpm --filter @thelamp/api e2e:fixtures`: a fictional tenant for one run of the Maestro flows
// (spec 14.4, decisions D68 and D86): a field user nobody has signed in yet, a place of theirs near
// the emulator's location, and an item with a price there for the order flow. It writes the flows'
// settings to a file Maestro reads with --env. Local databases only, as the seed is; seeded people
// are never signed in on a test device.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { CreateAccountBody, CreateUserBody, newId, PriceListBody } from '@thelamp/shared';
import { createCommandContext, report } from './context';
import { isLocalDatabase } from './db/bootstrap';
import { AccountsService } from './modules/accounts/accounts.service';
import { CatalogueService } from './modules/catalogue/catalogue.service';
import { ItemsImport } from './modules/catalogue/items.import';
import { PriceListsService } from './modules/catalogue/price-lists.service';
import { SYSTEM } from './modules/iam/actor';
import { UsersService } from './modules/iam/users.service';
import { TenantProvisioner } from './modules/provisioning/provisioner';
import { TerritoriesService } from './modules/territories/territories.service';
import { SYSTEM_ACTOR, userActor } from './platform/audit';
import { AccessResolver } from './platform/auth';
import { Database } from './platform/database';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '../mobile/.maestro/.env' },
    // A real phone's flows use its own GPS, so the place goes where the phone is.
    near: { type: 'string' },
  },
});

/**
 * Where the place is: by default Connaught Place, New Delhi, where the flows put an emulator.
 * `--near none` leaves it without a location, as a new place is until someone verifies it: a real
 * phone's flows use its own GPS, which Android doesn't share precisely over USB.
 */
const [lat, lng] = (values.near ?? '28.6315,77.2167').split(',').map(Number);
const located = values.near !== 'none';
if (located && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
  console.error(
    'Use --near with a latitude and longitude, such as --near 28.6315,77.2167, or none.',
  );
  process.exit(1);
}
const HERE = { lat: lat ?? 0, lng: lng ?? 0 };

const { app, config } = await createCommandContext();
try {
  if (!isLocalDatabase(config.DATABASE_URL)) {
    throw new Error('Maestro fixtures are made on a local database only.');
  }
  // Fictional numbers in a block no seed or load fixture uses, different on every run.
  const run = randomBytes(3).readUIntBE(0, 3) % 1_000_000;
  const phone = (index: number) => `+916${String(run).padStart(6, '0')}${index}00`;
  const { tenantId, admin } = await app.get(TenantProvisioner).provision({
    name: `Maestro ${run}`,
    slug: `maestro-${run}-${Date.now().toString(36)}`,
    template: 'generic',
    status: 'active',
    admin: { code: 'ADMIN-1', name: 'Maestro Admin', phone: phone(0) },
  });
  const database = app.get(Database);
  const field = await database.forTenant(tenantId, async (tx) => {
    const region = await app
      .get(TerritoriesService)
      .add(tx, tenantId, SYSTEM_ACTOR, { code: 'E2E', name: 'Test Region', parentId: null });
    const person = await app.get(UsersService).create(
      tx,
      tenantId,
      SYSTEM,
      CreateUserBody.parse({
        code: 'FU-1',
        name: 'Asha Verma',
        phone: phone(1),
        designation: 'executive',
        role: 'field_user',
        managerId: admin.id,
        territoryIds: [region.id],
      }),
    );
    return { person, region };
  });
  const access = await app.get(AccessResolver).onBehalfOf(tenantId, admin.id, config.CELL_ID);
  await database.forTenant(tenantId, (tx) =>
    app.get(AccountsService).create(
      tx,
      access,
      CreateAccountBody.parse({
        id: newId(),
        type: 'customer',
        code: 'MS-1',
        name: 'Maestro Stores',
        territoryId: field.region.id,
        ...(located ? { location: HERE } : {}),
        slots: { executive: field.person.id },
      }),
    ),
  );

  // An item the place can order, on the company's list.
  await database.forTenant(tenantId, async (tx) => {
    const catalogue = app.get(CatalogueService);
    const unit = (await catalogue.settings(tx, tenantId)).units.find((each) => each.base)!.key;
    await app.get(ItemsImport).commit(
      tx,
      [
        {
          row: 2,
          cells: {
            item_code: 'MS-SEED',
            item_name: 'Maestro Seeds 1 kg',
            product_name: 'Maestro Seeds',
            pack_label: '1 kg',
            base_unit: unit,
            tax_rate: '5',
            mrp: '250',
          },
        },
      ],
      { access, target: 'items', emptyValues: [], fractions: [] },
    );
    const [item] = await catalogue.items(tx, tenantId);
    const lists = app.get(PriceListsService);
    const id = newId();
    const { list } = await lists.put(
      tx,
      tenantId,
      userActor(access),
      id,
      PriceListBody.parse({ name: 'Standard rates', scope: 'default', validFrom: '2026-01-01' }),
    );
    await lists.setItems(tx, tenantId, userActor(access), id, {
      set: [{ itemId: item!.id, price: '200', discount: '0' }],
      remove: [],
      version: list.version,
    });
  });

  // The number as people type it, without the country code.
  const settings = {
    PHONE: phone(1).slice(3),
    PHONE_E164_DIGITS: phone(1).slice(1),
    ACCOUNT: 'Maestro Stores',
    ITEM_CODE: 'MS-SEED',
    LAT: String(HERE.lat),
    LNG: String(HERE.lng),
    // Mailpit's API, which the emulator reaches through `adb reverse tcp:8025 tcp:8025`.
    MAILPIT: 'http://127.0.0.1:8025',
  };
  mkdirSync(dirname(values.out!), { recursive: true });
  writeFileSync(
    values.out!,
    Object.entries(settings)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
  console.log(`Tenant Maestro ${run} is ready; the flows' settings are in ${values.out}.`);
} catch (error) {
  report(error);
} finally {
  await app.close();
}
