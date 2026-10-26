import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addMonths, BILLING_TIME_ZONE, newId, todayIn } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingCycle } from '../src/modules/billing/billing-cycle';
import { type MemoryGateway, PaymentGateway } from '../src/modules/billing/gateway';
import { StaffService } from '../src/modules/console/staff.service';
import { totpAt, totpStep } from '../src/platform/totp';
import { newDevice, newPhone, settledStep, startApp, testConfig, World } from './support';

/**
 * Phase 3's exit checks that code can prove (spec 15, decision D100): a new tenant is onboarded
 * from the console without anyone touching the database, from its creation to a field person's
 * first punch-in, and billing charges that tenant end to end, from its plan to a paid invoice.
 * The clock time of an onboarding (under a day) is the runbook's to measure
 * (docs/runbooks/tenant-onboarding.md); the penetration test and the stores are not code's.
 */

let app: NestFastifyApplication;
let world: World;
let staff: string;

const TODAY = todayIn(BILLING_TIME_ZONE, new Date());
/** The day this month's seats are first invoiced: the 4th of next month, mid-morning. */
const INVOICE_DAY = `${addMonths(`${TODAY.slice(0, 7)}-01`, 1).slice(0, 7)}-04`;
/** Connaught Place, New Delhi. */
const HERE = { lat: 28.6315, lng: 77.2167 };

const address = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function send(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

/** A platform admin invited, set up with an authenticator, and signed in. */
async function staffToken(): Promise<string> {
  const email = `exit-${newId().slice(-8)}@vendor.example`;
  const { setupUrl } = await app
    .get(StaffService)
    .invite({ id: newId(), email, name: 'Onboarding Lead', role: 'platform_admin' }, null);
  const token = setupUrl.split('#')[1]!;
  const password = 'a long staff password';
  const setUp = await app.inject({
    method: 'POST',
    url: '/platform/v1/setup',
    remoteAddress: address(),
    payload: { token, password },
  });
  const { secret } = setUp.json();
  await app.inject({
    method: 'POST',
    url: '/platform/v1/setup/confirm',
    remoteAddress: address(),
    payload: { token, code: totpAt(secret, (await settledStep()) - 1) },
  });
  const signedIn = await app.inject({
    method: 'POST',
    url: '/platform/v1/session',
    remoteAddress: address(),
    payload: { email, password, code: totpAt(secret, totpStep()) },
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return signedIn.json().accessToken;
}

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
  staff = await staffToken();
});

afterAll(async () => {
  await world.end();
  await app.close();
});

describe('phase 3 exit (spec 15)', () => {
  it('onboards a tenant from the console to its first punch-in, then bills and charges it', async () => {
    // The vendor: a plan, the seller's details, and the tenant from a template with its admin.
    const settings = await send('PUT', '/platform/v1/billing/settings', staff, {
      seller: {
        legalName: 'Example Field Software Private Limited',
        gstin: '27ZZZZZ0000Z1ZQ',
        address: 'Unit 4, Example Business Park, Pune 411045',
        stateCode: '27',
        email: 'billing@vendor.example',
        sac: '998314',
      },
      invoicePrefix: 'TL',
      gstRate: '18',
      paymentTermsDays: 15,
      graceDays: 7,
      readOnlyDays: 14,
    });
    expect(settings.statusCode, settings.body).toBe(200);
    const planId = newId();
    const plan = await send('POST', '/platform/v1/plans', staff, {
      id: planId,
      key: `exit${newId().slice(-6)}`,
      name: { en: 'Field', hi: 'फ़ील्ड' },
      priceMonth: '499',
      priceYear: '4990',
      modules: ['core', 'leave_attendance', 'orders', 'account_finance', 'expenses'],
    });
    expect(plan.statusCode, plan.body).toBe(201);

    const tenantId = newId();
    const adminPhone = newPhone();
    const created = await send('POST', '/platform/v1/tenants', staff, {
      id: tenantId,
      name: 'Exit Check Traders',
      slug: `exit-${newId().slice(-8)}`,
      template: 'generic',
      status: 'trial',
      trialDays: 14,
      admin: { name: 'Kiran Patil', phone: adminPhone },
    });
    expect(created.statusCode, created.body).toBe(201);
    const onPlan = await send('PUT', `/platform/v1/tenants/${tenantId}/plan`, staff, { planId });
    expect(onPlan.statusCode, onPlan.body).toBe(200);

    // The tenant's admin, on the web with their authenticator, sets up the organisation.
    const admin = (await world.signIn(adminPhone)).accessToken;
    const named = await send('PATCH', '/v1/settings', admin, {
      legalName: 'Exit Check Traders Private Limited',
    });
    expect(named.statusCode, named.body).toBe(200);
    const territory = await send('POST', '/v1/territories', admin, {
      code: 'N-DEL',
      name: 'North Delhi',
    });
    expect(territory.statusCode, territory.body).toBe(201);
    const fieldPhone = newPhone();
    const person = await send('POST', '/v1/users', admin, {
      code: 'EXT-001',
      name: 'Asha Verma',
      phone: fieldPhone,
      designation: 'executive',
    });
    expect(person.statusCode, person.body).toBe(201);
    const accountId = newId();
    const account = await send('POST', '/v1/accounts', admin, {
      id: accountId,
      type: 'customer',
      code: 'C-0001',
      name: 'Sharma Stores',
      territoryId: territory.json().id,
      location: HERE,
      slots: { executive: person.json().id },
    });
    expect(account.statusCode, account.body).toBe(201);

    // The field person signs in on their phone, finds their account offline-ready, and starts the day.
    const field = (await world.signIn(fieldPhone, newDevice())).accessToken;
    const pulled = (await send('GET', '/v1/sync/pull?entities=accounts', field)).json();
    expect(pulled.entities.accounts.rows.map((row: { id: string }) => row.id)).toContain(accountId);
    const shift = await send('POST', '/v1/shifts', field, {
      id: newId(),
      startedAt: new Date().toISOString(),
      location: HERE,
      accuracy: 15,
      mocked: false,
      consentVersion: '2026-10',
    });
    expect(shift.statusCode, shift.body).toBe(201);

    // Billing: details, an automatic-payment mandate, a monthly subscription, then the month.
    const details = await send('PUT', `/platform/v1/tenants/${tenantId}/billing-account`, staff, {
      legalName: 'Exit Check Traders Private Limited',
      gstin: null,
      address: 'Plot 9, MIDC Industrial Area, Nashik 422010',
      stateCode: '27',
      email: `accounts-${newId().slice(-8)}@customer.example`,
    });
    expect(details.statusCode, details.body).toBe(200);
    expect((await send('POST', `/platform/v1/tenants/${tenantId}/mandate`, staff)).json()).toEqual({
      url: null,
    });
    const subscribed = await send('PUT', `/platform/v1/tenants/${tenantId}/subscription`, staff, {
      planId,
      cycle: 'month',
    });
    expect(subscribed.statusCode, subscribed.body).toBe(200);
    await app.get(BillingCycle).run(new Date(`${INVOICE_DAY}T10:00:00+05:30`), [tenantId]);

    const invoices = (await send('GET', `/platform/v1/invoices?tenantId=${tenantId}`, staff)).json()
      .items;
    expect(invoices).toHaveLength(1);
    const [invoice] = invoices;
    // Issued once the month settled, and charged through the mandate on the day of issue.
    expect(invoice).toMatchObject({ kind: 'monthly', issuedOn: INVOICE_DAY, status: 'paid' });
    const charges = (app.get(PaymentGateway) as MemoryGateway).charges.filter(
      (charge) => charge.invoiceId === invoice.id,
    );
    expect(charges).toEqual([
      { invoiceId: invoice.id, number: invoice.number, amount: invoice.total },
    ]);
    const billing = (await send('GET', `/platform/v1/tenants/${tenantId}/billing`, staff)).json();
    expect(billing).toMatchObject({ account: { mandate: 'active' } });
    expect((await send('GET', `/platform/v1/tenants/${tenantId}`, staff)).json().status).toBe(
      'active',
    );
    // The tenant's admin sees the same paid invoice in Settings › Billing.
    const portal = (await send('GET', '/v1/billing/invoices', admin)).json();
    expect(portal.items).toEqual([
      expect.objectContaining({ id: invoice.id, number: invoice.number, status: 'paid' }),
    ]);
  });
});
