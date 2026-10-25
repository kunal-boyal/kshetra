import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  addDays,
  addMonths,
  BILLING_TIME_ZONE,
  billableSeats,
  gstOn,
  lineAmount,
  newId,
  periodDays,
  termQuarters,
  todayIn,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenants } from '../src/db/schema/directory';
import { BillingCycle } from '../src/modules/billing/billing-cycle';
import { PaymentGateway, type MemoryGateway } from '../src/modules/billing/gateway';
import { StaffService } from '../src/modules/console/staff.service';
import { totpAt, totpStep } from '../src/platform/totp';
import { DirectoryDatabase } from '../src/modules/directory/directory.database';
import { EmailSender, type MemoryEmailSender } from '../src/modules/notifications/senders';
import { newPhone, startApp, testConfig, World } from './support';

/**
 * Billing (module M23, BR-47 to BR-49, decision D90): subscriptions, monthly invoices in arrears,
 * annual terms and their true-ups, GST by place of supply, payments by mandate and by transfer,
 * dunning to read only and suspension, cancelling, and trials that end.
 */

let app: NestFastifyApplication;
let world: World;
let staff: string;
let planId: string;

const gateway = () => app.get(PaymentGateway) as MemoryGateway;
const emails = () => (app.get(EmailSender) as MemoryEmailSender).sent;

const TODAY = todayIn(BILLING_TIME_ZONE, new Date());
const MONTH = TODAY.slice(0, 7);
/** A moment on a day on the vendor's clock, mid-morning. */
const at = (day: string) => new Date(`${day}T10:00:00+05:30`);
/** The day this month's seats are first invoiced: the 4th of next month. */
const INVOICE_DAY = `${addMonths(`${MONTH}-01`, 1).slice(0, 7)}-04`;

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

async function staffToken(): Promise<string> {
  const email = `invoicing-${newId().slice(-8)}@vendor.example`;
  const { setupUrl } = await app
    .get(StaffService)
    .invite({ id: newId(), email, name: 'Finance Person', role: 'platform_admin' }, null);
  const token = setupUrl.split('#')[1]!;
  const setUp = await app.inject({
    method: 'POST',
    url: '/platform/v1/setup',
    remoteAddress: address(),
    payload: { token, password: 'a long staff password' },
  });
  const { secret } = setUp.json();
  await app.inject({
    method: 'POST',
    url: '/platform/v1/setup/confirm',
    remoteAddress: address(),
    payload: { token, code: totpAt(secret, totpStep()) },
  });
  const signedIn = await app.inject({
    method: 'POST',
    url: '/platform/v1/session',
    remoteAddress: address(),
    payload: { email, password: 'a long staff password', code: totpAt(secret, totpStep() + 1) },
  });
  return signedIn.json().accessToken;
}

const SETTINGS = {
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
};

/** A tenant with its admin signed in, its billing details set, in Maharashtra unless told. */
async function customer(name: string, stateCode = '27', gstin: string | null = null) {
  const tenantId = await world.tenant(name);
  mine.push(tenantId);
  const phone = newPhone();
  await world.user(tenantId, {
    phone,
    designation: 'head',
    role: 'tenant_admin',
    email: `admin-${newId().slice(-8)}@customer.example`,
  });
  const admin = (await world.signIn(phone)).accessToken;
  const billingEmail = `accounts-${newId().slice(-8)}@customer.example`;
  const account = await send('PUT', `/platform/v1/tenants/${tenantId}/billing-account`, staff, {
    legalName: `${name} Private Limited`,
    gstin,
    address: 'Plot 9, MIDC Industrial Area, Nashik 422010',
    stateCode,
    email: billingEmail,
  });
  expect(account.statusCode, account.body).toBe(200);
  return { tenantId, admin, billingEmail };
}

const subscribe = (tenantId: string, body: object = { planId, cycle: 'month' }) =>
  send('PUT', `/platform/v1/tenants/${tenantId}/subscription`, staff, body);

const invoicesOf = async (tenantId: string) =>
  (await send('GET', `/platform/v1/invoices?tenantId=${tenantId}`, staff)).json().items as {
    id: string;
    number: string;
    kind: string;
    total: string;
    status: string;
    lines: { quantity: string; rate: string; amount: string }[];
    [key: string]: unknown;
  }[];

const statusOf = async (tenantId: string) =>
  (await send('GET', `/platform/v1/tenants/${tenantId}`, staff)).json().status;

/** The tenants this file made: billing runs only for them, so other files' tenants are left be. */
const mine: string[] = [];
const cycle = (day: string) => app.get(BillingCycle).run(at(day), mine);

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
  staff = await staffToken();
  const settings = await send('PUT', '/platform/v1/billing/settings', staff, SETTINGS);
  expect(settings.statusCode, settings.body).toBe(200);
  planId = newId();
  const plan = await send('POST', '/platform/v1/plans', staff, {
    id: planId,
    key: `bill${newId().slice(-6)}`,
    name: { en: 'Field', hi: 'फ़ील्ड' },
    priceMonth: '499',
    priceYear: '4990',
    modules: ['core', 'leave_attendance', 'orders', 'account_finance', 'expenses'],
  });
  expect(plan.statusCode, plan.body).toBe(201);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

describe('billing settings (D90)', () => {
  it('checks the seller’s GSTIN against its state, and is ready once set', async () => {
    const wrong = await send('PUT', '/platform/v1/billing/settings', staff, {
      ...SETTINGS,
      seller: { ...SETTINGS.seller, stateCode: '29' },
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'seller.gstin', issue: 'The GSTIN is for another state' },
    ]);
    expect((await send('GET', '/platform/v1/billing/settings', staff)).json()).toMatchObject({
      invoicePrefix: 'TL',
      example: false,
      ready: true,
    });
  });
});

describe('monthly subscriptions (BR-47)', () => {
  it('needs billing details, then invoices each settled month once, with CGST and SGST', async () => {
    const bare = await world.tenant('Unbilled Co');
    mine.push(bare);
    const refused = await subscribe(bare);
    expect(refused.json().error.code).toBe('CONFLICT');

    const c = await customer('Monthly Co');
    const started = await subscribe(c.tenantId);
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().subscription).toMatchObject({ cycle: 'month', startedOn: TODAY });
    // The tenant goes on the subscription's plan.
    const entitled = await send('GET', `/platform/v1/tenants/${c.tenantId}/entitlements`, staff);
    expect(entitled.json().plan.id).toBe(planId);

    // Nothing is billed until the month has settled.
    await cycle(addDays(INVOICE_DAY, -1));
    expect(await invoicesOf(c.tenantId)).toEqual([]);
    await cycle(INVOICE_DAY);
    await cycle(INVOICE_DAY);
    const issued = await invoicesOf(c.tenantId);
    expect(issued).toHaveLength(1);
    const invoice = issued[0]!;
    // The admin started today: billed by day from today to the month's end (BR-45).
    const { start, end } = periodDays(MONTH);
    const seats = billableSeats([{ userId: 'admin', from: TODAY, to: null }], start, end);
    const subtotal = lineAmount(seats.units, '499.00');
    const { cgst, sgst, igst, total } = gstOn(subtotal, '18', '27', '27');
    expect(invoice).toMatchObject({
      kind: 'monthly',
      period: { from: TODAY, to: end },
      issuedOn: INVOICE_DAY,
      dueOn: addDays(INVOICE_DAY, 15),
      lines: [{ quantity: seats.units, rate: '499.00', amount: subtotal }],
      subtotal,
      gstRate: '18',
      cgst,
      sgst,
      igst,
      total,
      status: 'issued',
      example: false,
      buyer: { stateCode: '27', stateName: 'Maharashtra' },
    });
    expect(invoice.number).toMatch(/^TL\/\d\d-\d\d\/\d{5}$/);
    expect(emails()).toContainEqual(
      expect.objectContaining({
        to: c.billingEmail,
        subject: `Invoice ${invoice.number} for Monthly Co`,
      }),
    );

    // Its PDF is drawn from what was issued.
    const pdf = await send('GET', `/platform/v1/invoices/${invoice.id}/pdf`, staff);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('charges IGST to a tenant in another state', async () => {
    const c = await customer('Bengaluru Co', '29', '29ZZZZZ0001Z1ZL');
    await subscribe(c.tenantId);
    await cycle(INVOICE_DAY);
    const [invoice] = await invoicesOf(c.tenantId);
    expect(invoice).toMatchObject({
      cgst: '0.00',
      sgst: '0.00',
      buyer: { gstin: '29ZZZZZ0001Z1ZL', stateName: 'Karnataka' },
    });
    expect(invoice!.igst).not.toBe('0.00');
  });

  it('records payments by transfer once each, never more than is owed', async () => {
    const c = await customer('Transfer Co');
    await subscribe(c.tenantId);
    await cycle(INVOICE_DAY);
    const [invoice] = await invoicesOf(c.tenantId);
    const total = invoice!.total;
    const pay = (body: object) =>
      send('POST', `/platform/v1/invoices/${invoice!.id}/payments`, staff, body);
    const part = { id: newId(), amount: '100', method: 'bank_transfer', receivedOn: INVOICE_DAY };
    expect((await pay(part)).json()).toMatchObject({ status: 'issued', paid: '100.00' });
    // The same payment again is recorded once; changed, it is refused.
    expect((await pay(part)).json().paid).toBe('100.00');
    expect((await pay({ ...part, amount: '101' })).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    const over = await pay({ ...part, id: newId(), amount: total });
    expect(over.json().error.details[0].path).toBe('amount');
    const rest = (BigInt(total.replace('.', '')) - 10_000n).toString();
    const paid = await pay({
      id: newId(),
      amount: `${rest.slice(0, -2)}.${rest.slice(-2)}`,
      method: 'upi',
      reference: 'UTR 4471',
      receivedOn: INVOICE_DAY,
    });
    expect(paid.json()).toMatchObject({ status: 'paid', paid: total });
    expect(paid.json().payments).toHaveLength(2);
  });
});

describe('dunning (BR-48)', () => {
  it('takes a refused charge to grace and read only, and back to active once paid', async () => {
    const c = await customer('Unpaid Co');
    expect(
      (await send('POST', `/platform/v1/tenants/${c.tenantId}/mandate`, staff)).json(),
    ).toEqual({
      url: null,
    });
    await subscribe(c.tenantId);
    gateway().refuse = 'Insufficient funds';
    try {
      await cycle(INVOICE_DAY);
    } finally {
      gateway().refuse = null;
    }
    const [invoice] = await invoicesOf(c.tenantId);
    // A mandate pays on the day of issue.
    expect(invoice).toMatchObject({ status: 'issued', dueOn: INVOICE_DAY });
    expect(await statusOf(c.tenantId)).toBe('grace');
    const billing = (await send('GET', `/platform/v1/tenants/${c.tenantId}/billing`, staff)).json();
    expect(billing).toMatchObject({
      account: { mandate: 'failed' },
      dunning: {
        overdueSince: INVOICE_DAY,
        stage: 'grace',
        readOnlyOn: addDays(INVOICE_DAY, 7),
        suspendOn: addDays(INVOICE_DAY, 21),
        outstanding: invoice!.total,
      },
    });
    const overdue = () =>
      emails().filter((email) => email.subject === 'Payment overdue for Unpaid Co');
    expect(overdue().map((email) => email.to)).toContain(c.billingEmail);
    const before = overdue().length;
    await cycle(addDays(INVOICE_DAY, 1));
    expect(overdue()).toHaveLength(before);

    // Read only from day 7: writes are refused, reads and exports still work.
    await cycle(addDays(INVOICE_DAY, 7));
    expect(await statusOf(c.tenantId)).toBe('read_only');
    const write = await send('PATCH', '/v1/settings', c.admin, { reviewAutoApproval: false });
    expect(write.statusCode).toBe(423);
    expect(write.json().error.code).toBe('TENANT_READ_ONLY');
    expect((await send('GET', '/v1/me', c.admin)).statusCode).toBe(200);
    expect(
      emails().filter((email) => email.subject === 'Unpaid Co can only read until paid'),
    ).not.toEqual([]);

    // Paid: active again, and writes go through.
    await send('POST', `/platform/v1/invoices/${invoice!.id}/payments`, staff, {
      id: newId(),
      amount: invoice!.total,
      method: 'bank_transfer',
      receivedOn: addDays(INVOICE_DAY, 8),
    });
    expect(await statusOf(c.tenantId)).toBe('active');
    expect(
      (await send('PATCH', '/v1/settings', c.admin, { reviewAutoApproval: false })).statusCode,
    ).toBe(200);
  });

  it('suspends after read only, and stays suspended until the console reactivates it', async () => {
    const c = await customer('Lapsed Co');
    await subscribe(c.tenantId);
    await cycle(INVOICE_DAY);
    const [invoice] = await invoicesOf(c.tenantId);
    // Unpaid by transfer: overdue the day after it falls due.
    const overdueOn = addDays(invoice!.dueOn as string, 1);
    await cycle(overdueOn);
    expect(await statusOf(c.tenantId)).toBe('grace');
    await cycle(addDays(overdueOn, 21));
    expect(await statusOf(c.tenantId)).toBe('suspended');
    expect((await send('GET', '/v1/me', c.admin)).json().error.code).toBe('TENANT_SUSPENDED');
    await send('POST', `/platform/v1/invoices/${invoice!.id}/payments`, staff, {
      id: newId(),
      amount: invoice!.total,
      method: 'cheque',
      receivedOn: addDays(overdueOn, 22),
    });
    await cycle(addDays(overdueOn, 22));
    expect(await statusOf(c.tenantId)).toBe('suspended');
    await send('POST', `/platform/v1/tenants/${c.tenantId}/reactivate`, staff);
    await cycle(addDays(overdueOn, 23));
    expect(await statusOf(c.tenantId)).toBe('active');
  });
});

describe('annual subscriptions (BR-47)', () => {
  it('invoices the term at once, and trues up a quarter’s extra seats', async () => {
    const c = await customer('Annual Co');
    const started = await subscribe(c.tenantId, { planId, cycle: 'year', committedSeats: 1 });
    expect(started.json().subscription).toMatchObject({
      cycle: 'year',
      committedSeats: 1,
      term: { from: TODAY, to: addDays(addMonths(TODAY, 12), -1) },
    });
    const [annual] = await invoicesOf(c.tenantId);
    expect(annual).toMatchObject({
      kind: 'annual',
      issuedOn: TODAY,
      lines: [{ quantity: '1.0000', rate: '4990.00', amount: '4990.00' }],
      subtotal: '4990.00',
    });
    // Monthly changes don't apply to an annual subscription.
    expect((await subscribe(c.tenantId)).json().error.code).toBe('CONFLICT');

    // Two more people in the first quarter: three seats against one committed.
    await world.user(c.tenantId, { phone: newPhone(), designation: 'executive' });
    await world.user(c.tenantId, { phone: newPhone(), designation: 'executive' });
    const [first] = termQuarters(TODAY);
    await cycle(addDays(first!.to, 3));
    expect((await invoicesOf(c.tenantId)).filter((i) => i.kind === 'true_up')).toEqual([]);
    await cycle(addDays(first!.to, 4));
    await cycle(addDays(first!.to, 5));
    const trueUps = (await invoicesOf(c.tenantId)).filter((i) => i.kind === 'true_up');
    expect(trueUps).toHaveLength(1);
    expect(trueUps[0]).toMatchObject({
      lines: [{ quantity: '2.0000', rate: '4990.00', amount: '9980.00' }],
      period: { from: TODAY, to: addDays(addMonths(TODAY, 12), -1) },
    });
    const billing = (await send('GET', `/platform/v1/tenants/${c.tenantId}/billing`, staff)).json();
    expect(billing.subscription.committedSeats).toBe(3);
  });
});

describe('ending (BR-47)', () => {
  it('invoices a cancelled month once it settles, then suspends the tenant', async () => {
    const c = await customer('Leaving Co');
    await subscribe(c.tenantId);
    const cancelled = await send(
      'POST',
      `/platform/v1/tenants/${c.tenantId}/subscription/cancel`,
      staff,
      { reason: 'Moving to another product' },
    );
    expect(cancelled.json().subscription.endsOn).toBe(TODAY);
    await cycle(INVOICE_DAY);
    expect(await invoicesOf(c.tenantId)).toHaveLength(1);
    expect(await statusOf(c.tenantId)).toBe('suspended');
    const billing = (await send('GET', `/platform/v1/tenants/${c.tenantId}/billing`, staff)).json();
    expect(billing.subscription.status).toBe('cancelled');
  });
});

describe('trials (spec 10.3)', () => {
  it('reminds a week before, then suspends a trial that ended without a subscription', async () => {
    const tenantId = await world.tenant('Trying Co', 'trial');
    mine.push(tenantId);
    const phone = newPhone();
    const adminEmail = `trial-${newId().slice(-8)}@customer.example`;
    await world.user(tenantId, {
      phone,
      designation: 'head',
      role: 'tenant_admin',
      email: adminEmail,
    });
    const endsAt = new Date(at(addDays(TODAY, 5)).getTime());
    await app
      .get(DirectoryDatabase)
      .db.update(tenants)
      .set({ trialEndsAt: endsAt })
      .where(eq(tenants.id, tenantId));
    await cycle(TODAY);
    await cycle(TODAY);
    const reminders = emails().filter(
      (email) =>
        email.to === adminEmail && email.subject.startsWith('The trial for Trying Co ends'),
    );
    expect(reminders).toHaveLength(1);
    await app.get(BillingCycle).run(new Date(endsAt.getTime() + 60_000), mine);
    expect(await statusOf(tenantId)).toBe('suspended');
    expect(emails()).toContainEqual(
      expect.objectContaining({ to: adminEmail, subject: 'The trial for Trying Co has ended' }),
    );
  });
});

describe('the portal’s billing page (spec M23)', () => {
  it('shows a tenant admin only their own organisation’s billing, read only included', async () => {
    const c = await customer('Portal Co');
    await subscribe(c.tenantId);
    await cycle(INVOICE_DAY);
    const other = await customer('Elsewhere Co');
    await subscribe(other.tenantId);
    await cycle(INVOICE_DAY);
    const [theirs] = await invoicesOf(other.tenantId);

    const overview = await send('GET', '/v1/billing', c.admin);
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json()).toMatchObject({
      plan: { name: { en: 'Field' }, priceMonth: '499.00', priceYear: '4990.00' },
      people: { active: 1, limit: null },
      account: { legalName: 'Portal Co Private Limited', mandate: 'none' },
      subscription: { cycle: 'month', startedOn: TODAY },
      automaticPayment: true,
      trialEndsAt: null,
    });
    const listed = (await send('GET', '/v1/billing/invoices', c.admin)).json().items;
    expect(listed).toHaveLength(1);
    expect(listed[0].tenant.id).toBe(c.tenantId);
    const own = await send('GET', `/v1/billing/invoices/${listed[0].id}/pdf`, c.admin);
    expect(own.headers['content-type']).toBe('application/pdf');
    // Another organisation's invoice answers as one that doesn't exist.
    const elsewhere = await send('GET', `/v1/billing/invoices/${theirs!.id}`, c.admin);
    expect(elsewhere.json().error.code).toBe('NOT_FOUND');

    // Only billing.manage sees billing.
    const phone = newPhone();
    // A manager signs in on the web but holds no billing.manage.
    await world.user(c.tenantId, { phone });
    const member = (await world.signIn(phone)).accessToken;
    expect((await send('GET', '/v1/billing', member)).json().error.code).toBe('FORBIDDEN');

    // Read only, an admin can still put the billing details right and set up payment.
    await app
      .get(DirectoryDatabase)
      .db.update(tenants)
      .set({ status: 'read_only' })
      .where(eq(tenants.id, c.tenantId));
    const details = await send('PUT', '/v1/billing/account', c.admin, {
      legalName: 'Portal Company Private Limited',
      address: 'Plot 9, MIDC Industrial Area, Nashik 422010',
      stateCode: '27',
      email: c.billingEmail,
    });
    expect(details.statusCode, details.body).toBe(200);
    expect(details.json().account.legalName).toBe('Portal Company Private Limited');
    const mandate = await send('POST', '/v1/billing/mandate', c.admin);
    expect(mandate.json()).toEqual({ url: null });
    expect((await send('GET', '/v1/billing', c.admin)).json().account.mandate).toBe('active');
    expect(
      (await send('PATCH', '/v1/settings', c.admin, { reviewAutoApproval: false })).statusCode,
    ).toBe(423);
  });
});

describe('invoice numbers (BR-47)', () => {
  it('run without gaps in each series', async () => {
    const all = (await send('GET', '/platform/v1/invoices?limit=100', staff)).json().items as {
      number: string;
    }[];
    const bySeries = new Map<string, number[]>();
    for (const { number } of all) {
      const series = number.slice(0, number.lastIndexOf('/'));
      bySeries.set(series, [...(bySeries.get(series) ?? []), Number(number.slice(-5))]);
    }
    for (const numbers of bySeries.values()) {
      const sorted = numbers.sort((x, y) => x - y);
      expect(sorted).toEqual(sorted.map((_, index) => index + 1));
    }
  });
});
