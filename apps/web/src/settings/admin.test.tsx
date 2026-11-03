import { ApiError } from '@thelamp/api-client';
import { SETTING_DEFAULTS } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { accentCss } from '../brand';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const ADMIN = ['settings.manage', 'terminology.manage', 'module.manage'] as const;
const ORGANISATION = { name: 'Sunrise Traders', logo: null };
const saved = (body: unknown) => ({ ...SETTING_DEFAULTS, ...(body as object) });

describe('the organisation (M2)', () => {
  it('saves the details and the colour at once, and renames only when changed', async () => {
    const client = fakeClient(
      { '/v1/organisation': ORGANISATION },
      {
        'PATCH /v1/settings': ({ body }) => saved(body),
        'PATCH /v1/organisation': ({ body }) => ({ ...ORGANISATION, ...(body as object) }),
      },
      ADMIN,
    );
    renderAt('/settings/organisation', client);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Organisation' });
    const save = within(form).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(
      within(form).getByRole('textbox', { name: 'Legal name' }),
      'Sunrise Traders Pvt Ltd',
    );
    await user.type(within(form).getByRole('textbox', { name: /GSTIN/ }), '07abcde1234f1z5');
    await user.type(
      within(form).getByRole('textbox', { name: /Your privacy policy/ }),
      'https://sunrise.example/privacy',
    );
    await user.type(within(form).getByRole('textbox', { name: 'Colour code' }), '#0f6e6e');
    await user.click(save);
    expect(await within(form).findByText('Saved.')).toBeVisible();
    expect(writesOf(client).map(([method, path]) => `${method} ${path}`)).toEqual([
      'PATCH /v1/settings',
    ]);
    expect(writesOf(client)[0]![3]).toEqual(
      expect.objectContaining({
        body: {
          legalName: 'Sunrise Traders Pvt Ltd',
          taxId: '07ABCDE1234F1Z5',
          privacyPolicyUrl: 'https://sunrise.example/privacy',
          brandColour: '#0f6e6e',
        },
      }),
    );
  });

  it('renames through the organisation, apart from the settings', async () => {
    const client = fakeClient(
      { '/v1/organisation': ORGANISATION },
      { 'PATCH /v1/organisation': ({ body }) => ({ ...ORGANISATION, ...(body as object) }) },
      ADMIN,
    );
    renderAt('/settings/organisation', client);
    const user = userEvent.setup();
    const name = await screen.findByRole('textbox', { name: /Display name/ });
    await user.clear(name);
    await user.type(name, 'Sunrise Agro');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client).map(([method, path]) => `${method} ${path}`)).toEqual([
        'PATCH /v1/organisation',
      ]),
    );
  });

  it('shows the words, the field rules, and which modules are on, switched on Modules (D135)', async () => {
    const client = fakeClient({ '/v1/organisation': ORGANISATION }, {}, ADMIN, {
      settings: { ...SETTING_DEFAULTS, modulesOff: ['statutory_payroll', 'inventory'] },
    });
    renderAt('/settings/organisation', client);
    const words = await screen.findByRole('table');
    expect(within(words).getAllByRole('row')).toHaveLength(11);
    expect(screen.getByRole('link', { name: 'Change words' })).toHaveAttribute(
      'href',
      '/settings/terminology',
    );
    const rules = screen.getByRole('region', { name: 'Field rules' });
    expect(within(rules).getByText('Within 300 m')).toBeVisible();
    const modules = screen.getByRole('region', { name: 'Modules' });
    // Shown, never switched here: Modules alone knows the plan and the opt-in modules.
    expect(within(modules).queryAllByRole('switch')).toHaveLength(0);
    expect(within(modules).queryAllByRole('checkbox')).toHaveLength(0);
    const row = (name: RegExp) =>
      within(modules)
        .getAllByRole('listitem')
        .find((item) => name.test(item.textContent ?? ''))!;
    expect(row(/^Core/)).toHaveTextContent('Always on');
    expect(row(/^Orders/)).toHaveTextContent(/On$/);
    expect(row(/^Inventory/)).toHaveTextContent(/Off$/);
    expect(row(/^Statutory payroll/)).toHaveTextContent(/Off$/);
    expect(within(modules).getByRole('link', { name: 'Change modules' })).toHaveAttribute(
      'href',
      '/settings/modules',
    );
  });

  it('says when a logo is too big, before sending it', async () => {
    const client = fakeClient({ '/v1/organisation': ORGANISATION }, {}, ADMIN);
    renderAt('/settings/organisation', client);
    const user = userEvent.setup();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'logo.png', { type: 'image/png' });
    await user.upload(await screen.findByLabelText('Add a logo'), big);
    expect(
      await screen.findByText('This image is larger than 2 MB. Choose a smaller one.'),
    ).toBeVisible();
    expect(writesOf(client)).toEqual([]);
  });

  it('refuses a brand colour too light for white text, and offers a darker shade', async () => {
    const client = fakeClient(
      { '/v1/organisation': ORGANISATION },
      { 'PATCH /v1/settings': ({ body }) => saved(body) },
      ADMIN,
    );
    renderAt('/settings/organisation', client);
    const user = userEvent.setup();
    const hex = await screen.findByRole('textbox', { name: 'Colour code' });
    await user.type(hex, '#9fd3ff');
    expect(screen.getByText(/Too light/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Use #[0-9a-f]{6} instead/ }));
    expect(screen.queryByText(/Too light/)).toBeNull();
    expect(screen.getByRole('group', { name: 'How it looks' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: { brandColour: expect.stringMatching(/^#[0-9a-f]{6}$/) },
      }),
    );
  });
});

describe('settings navigation (decision D104)', () => {
  it('groups the pages, marks the group holding the page, and lists its pages', async () => {
    const client = fakeClient({ '/v1/organisation': ORGANISATION }, {}, ADMIN);
    renderAt('/settings/rules', client);
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    // The group and its first page share the name.
    const [group] = await within(nav).findAllByRole('link', { name: 'Organisation' });
    expect(group).toHaveAttribute('aria-current', 'true');
    const pages = within(nav).getByRole('list', { name: 'Pages in Organisation' });
    expect(within(pages).getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'People and access' })).toBeVisible();
  });

  it('shows a caller only the groups and pages they may open', async () => {
    const client = fakeClient({}, {}, ['form.manage']);
    renderAt('/settings/designations', client);
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    await waitFor(() =>
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['People and access', 'Field work', 'Designations', 'People fields']),
    );
  });
});

describe('rules (M2, spec 5.1)', () => {
  it('sends only what changed', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const radius = await screen.findByRole('spinbutton', { name: 'Geofence radius' });
    await user.clear(radius);
    await user.type(radius, '450');
    await user.click(screen.getByRole('checkbox', { name: /Ask for a selfie/ }));
    // Odometer readings at the punches (decision D99).
    await user.selectOptions(
      screen.getByRole('combobox', { name: /^Odometer when the day starts/ }),
      'required',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { geofenceRadiusMeters: 450, attendanceSelfie: true, odometer: 'required' },
    });
    expect(Object.keys((writesOf(client)[0]![3] as { body: object }).body)).toHaveLength(3);
  });

  it('sets the day’s cash limit for collections, blank for none (BR-63, D132)', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const limit = await screen.findByRole('textbox', { name: /in a day must stay under/ });
    expect(limit).toHaveValue('200000.00');
    await user.clear(limit);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({ body: { collectionCashLimit: null } });
  });

  it('counts the cash limit in the organisation’s own currency', async () => {
    const client = fakeClient({}, {}, ADMIN, {
      settings: { ...SETTING_DEFAULTS, currency: 'USD' },
    });
    renderAt('/settings/rules', client);
    const limit = await screen.findByRole('textbox', { name: /in a day must stay under$/ });
    expect(limit.closest('.ks-affix')).toHaveTextContent('$');
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it('switches evidence checks off one at a time, each naming its threshold (BR-50)', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const checks = await screen.findByRole('region', { name: 'Evidence checks' });
    expect(within(checks).getAllByRole('checkbox')).toHaveLength(5);
    for (const box of within(checks).getAllByRole('checkbox')) expect(box).toBeChecked();
    const speed = within(checks).getByRole('checkbox', {
      name: 'Flag travel between records faster than 100 km/h',
    });
    await user.click(speed);
    await user.click(
      within(checks).getByRole('checkbox', { name: 'Flag forms filled outside a shift' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
      anomalyFlagsOff: ['fast_travel', 'off_shift'],
    });
  });
});

describe('orders’ and account finance’s rules', () => {
  it('sets whether orders need a punch-in and may be taken offline', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const shift = within(orders).getByRole('checkbox', { name: /only after start day/ });
    const offline = within(orders).getByRole('checkbox', { name: /offline/ });
    expect(shift).not.toBeChecked();
    expect(offline).toBeChecked();
    await user.click(shift);
    await user.click(offline);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
      ordersNeedOpenShift: true,
      ordersAllowedOffline: false,
    });
  });

  it('edits the ageing bands, refusing overlaps before sending (BR-20)', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const ageing = await screen.findByRole('region', { name: 'Ageing' });
    expect(within(ageing).getAllByRole('group')).toHaveLength(5);
    const first = within(ageing).getByRole('group', { name: 'Band 1' });
    const to = within(first).getByRole('spinbutton', { name: /To day/ });
    await user.clear(to);
    await user.type(to, '45');
    expect(within(ageing).getByRole('alert')).toHaveTextContent(/must start after/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(to);
    await user.type(to, '30');
    await user.click(within(ageing).getByRole('button', { name: 'Add a band' }));
    expect(within(ageing).queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
      ageingBuckets: [
        { key: 'd0_30', fromDays: 0, toDays: 30 },
        { key: 'd31_60', fromDays: 31, toDays: 60 },
        { key: 'd61_90', fromDays: 61, toDays: 90 },
        { key: 'd91_180', fromDays: 91, toDays: 180 },
        { key: 'd181', fromDays: 181, toDays: 210 },
        { key: 'd211', fromDays: 211, toDays: null },
      ],
    });
  });

  it('leaves each module’s rules out while it is off', async () => {
    const client = fakeClient({}, {}, ADMIN, {
      settings: { ...SETTING_DEFAULTS, modulesOff: ['orders', 'account_finance'] },
    });
    renderAt('/settings/rules', client);
    expect(await screen.findByRole('region', { name: 'Evidence checks' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ageing' })).toBeNull();
  });
});

describe('stock rules (D130)', () => {
  it('chooses where stock comes from and the count tolerance while inventory is on', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const stock = await screen.findByRole('region', { name: 'Stock' });
    await user.selectOptions(
      within(stock).getByRole('combobox', { name: /Where stock comes from/ }),
      'books',
    );
    const tolerance = within(stock).getByRole('spinbutton', { name: /A count is flagged/ });
    await user.clear(tolerance);
    await user.type(tolerance, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
      stockSource: 'books',
      countTolerancePct: 10,
    });
  });

  it('leaves stock out while inventory is off', async () => {
    const client = fakeClient({}, {}, ADMIN, {
      settings: { ...SETTING_DEFAULTS, modulesOff: ['inventory'] },
    });
    renderAt('/settings/rules', client);
    expect(await screen.findByRole('region', { name: 'Evidence checks' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Stock' })).toBeNull();
  });
});

describe('the forecast plan metric (D126)', () => {
  it('offers the money metrics in use, and none', async () => {
    const entry = (key: string, unit: string, active = true) => ({
      definition: { key, name: noun(key, `${key} figures`), unit },
      active,
      version: 1,
    });
    const client = fakeClient(
      {
        '/v1/metric-definitions': {
          metrics: [
            entry('order_value', 'currency'),
            entry('visits', 'count'),
            entry('old_sales', 'currency', false),
          ],
          score: null,
        },
      },
      { 'PATCH /v1/settings': ({ body }) => saved(body) },
      ADMIN,
    );
    renderAt('/settings/rules', client);
    const user = userEvent.setup();
    const choice = await screen.findByRole('combobox', { name: /Metric to set forecasts beside/ });
    await waitFor(() =>
      expect(
        within(choice)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['None', 'order_value figures']),
    );
    await user.selectOptions(choice, 'order_value figures');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
      forecastPlanMetric: 'order_value',
    });
  });
});

describe('terminology (M2, spec 5.2)', () => {
  it('saves the terms filled in, Hindi left blank taking the English, and keeps the product word for the rest', async () => {
    const client = fakeClient(
      { '/v1/terminology': { overrides: {} } },
      { 'PUT /v1/terminology': ({ body }) => ({ overrides: body }) },
      ADMIN,
    );
    renderAt('/settings/terminology', client);
    const user = userEvent.setup();
    const section = await screen.findByRole('region', { name: 'Accounts' });
    const [oneEn, otherEn, oneHi, otherHi] = within(section).getAllByRole('textbox');
    await user.type(oneEn!, 'Customer');
    await user.type(otherEn!, 'Customers');
    await user.type(oneHi!, 'ग्राहक');
    await user.type(otherHi!, 'ग्राहक');
    // English alone: the Hindi takes it.
    const order = screen.getByRole('region', { name: 'Orders' });
    const [orderOne, orderOther] = within(order).getAllByRole('textbox');
    await user.type(orderOne!, 'Indent');
    await user.type(orderOther!, 'Indents');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
        'term.account': {
          en: { one: 'Customer', other: 'Customers' },
          hi: { one: 'ग्राहक', other: 'ग्राहक' },
        },
        'term.order': {
          en: { one: 'Indent', other: 'Indents' },
          hi: { one: 'Indent', other: 'Indents' },
        },
      }),
    );
    expect(await screen.findByText('Saved.')).toBeVisible();
  });

  it('saves nothing while a term is partly filled in, and says which box is missing', async () => {
    const client = fakeClient(
      { '/v1/terminology': { overrides: {} } },
      { 'PUT /v1/terminology': ({ body }) => ({ overrides: body }) },
      ADMIN,
    );
    renderAt('/settings/terminology', client);
    const user = userEvent.setup();
    const field = await screen.findByRole('region', { name: 'Field users' });
    await user.type(within(field).getAllByRole('textbox')[0]!, 'SME');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Some terms are only partly filled in/)).toBeVisible();
    expect(
      within(field).getByRole('textbox', { name: /Many, in English/ }),
    ).toHaveAccessibleDescription(expect.stringContaining('Fill this in too'));
    expect(screen.queryByText('Saved.')).toBeNull();
    expect(writesOf(client)).toEqual([]);

    await user.type(within(field).getByRole('textbox', { name: /Many, in English/ }), 'SMEs');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
        'term.field_user': { en: { one: 'SME', other: 'SMEs' }, hi: { one: 'SME', other: 'SMEs' } },
      }),
    );
  });
});

describe('modules (M2, spec 5.13)', () => {
  // Without a plan, or on one that leaves nothing out (decision D89).
  const OPEN_PLAN = { '/v1/modules': { outsidePlan: [] } };

  it('switches a module off; Core always stays on', async () => {
    // As the server reads it: statutory payroll and inventory off until switched on (D128, D130).
    const client = fakeClient(
      OPEN_PLAN,
      { 'PATCH /v1/settings': ({ body }) => saved(body) },
      ADMIN,
      {
        settings: { ...SETTING_DEFAULTS, modulesOff: ['statutory_payroll', 'inventory'] },
      },
    );
    renderAt('/settings/modules', client);
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Modules' });
    expect(within(list).getByText('Always on')).toBeVisible();
    expect(within(list).queryAllByText('Arrives later')).toHaveLength(0);
    expect(within(list).getAllByRole('checkbox', { name: 'On' })).toHaveLength(10);
    const module = (name: string) => within(within(list).getByText(name).closest('li')!);
    // Statutory payroll starts off (decision D128); switching it on names it on.
    await user.click(module('Statutory payroll').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Leave and attendance').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Orders').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Account finance').getByRole('checkbox', { name: 'On' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: {
          // Inventory stays off: opt-in, and not switched on here.
          modulesOff: ['inventory', 'leave_attendance', 'orders', 'account_finance'],
          modulesOn: ['statutory_payroll'],
        },
      }),
    );
  });

  it('says what stops while integrations or single sign-on are off (D125)', async () => {
    const client = fakeClient(
      OPEN_PLAN,
      { 'PATCH /v1/settings': ({ body }) => saved(body) },
      ADMIN,
    );
    renderAt('/settings/modules', client);
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Modules' });
    const module = (name: string) => within(within(list).getByText(name).closest('li')!);
    expect(within(list).queryByText(/API clients get no tokens/)).toBeNull();
    await user.click(module('Integrations').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Single sign-on').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Payroll inputs').getByRole('checkbox', { name: 'On' }));
    expect(module('Integrations').getByText(/API clients get no tokens/)).toBeVisible();
    expect(module('Single sign-on').getByText(/with a one-time code/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: { modulesOff: ['integrations', 'sso', 'payroll_inputs'] },
      }),
    );
  });

  it('offers no switch for a module the plan leaves out, and says why (D89)', async () => {
    const client = fakeClient(
      { '/v1/modules': { outsidePlan: ['inventory', 'sso'] } },
      {
        'PATCH /v1/settings': () => {
          throw new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
            { path: 'modulesOn', issue: 'Your plan does not include statutory_payroll' },
          ]);
        },
      },
      ADMIN,
      { settings: { ...SETTING_DEFAULTS, modulesOff: ['statutory_payroll', 'inventory', 'sso'] } },
    );
    renderAt('/settings/modules', client);
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Modules' });
    const module = (name: string) => within(within(list).getByText(name).closest('li')!);
    for (const name of ['Inventory', 'Single sign-on']) {
      expect(module(name).getByText('Not in your plan')).toBeVisible();
      expect(module(name).getByText(/Ask us to add it to your plan/)).toBeVisible();
      expect(module(name).queryByRole('checkbox')).toBeNull();
    }
    // What stops while it is off is for modules the admin can switch.
    expect(module('Single sign-on').queryByText(/with a one-time code/)).toBeNull();
    expect(within(list).getAllByRole('checkbox', { name: 'On' })).toHaveLength(8);
    // Should the plan change while the page is open, the refusal says so in words.
    await user.click(module('Statutory payroll').getByRole('checkbox', { name: 'On' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your plan doesn’t include a module you switched on.',
    );
  });
});

describe('the tenant accent on the web (tenant-theming.md)', () => {
  it('writes the six accent variables for each theme', () => {
    const css = accentCss('#0f6e6e');
    expect(css).toContain(':root[data-theme="light"]{--accent:#0f6e6e;');
    expect(css).toContain(':root[data-theme="dark"]{--accent:');
    expect(css).toContain(':root[data-theme="outdoor"]{--accent:');
    expect(css.match(/--on-accent:/g)).toHaveLength(3);
  });
});

describe('roles (spec 4.2)', () => {
  it('renames the admin role and sends nothing else, its permissions shown as they stay', async () => {
    const id = '01a10000-0000-7000-8000-000000000040';
    const role = {
      id,
      key: 'tenant_admin',
      name: { en: 'Admin', hi: 'एडमिन' },
      scope: 'tenant',
      permissions: ['user.view', 'role.manage'],
      mobileOnly: false,
      system: true,
    };
    const client = fakeClient(
      { '/v1/roles': { items: [role] } },
      { [`PATCH /v1/roles/${id}`]: ({ body }) => ({ ...role, ...(body as object) }) },
      ['role.manage'],
    );
    renderAt('/settings/roles', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Admin' });
    expect(within(form).getByText(/Only its name can change/)).toBeVisible();
    expect(within(form).getByRole('combobox', { name: 'Whose records it reaches' })).toBeDisabled();
    expect(within(form).getByRole('checkbox', { name: /Mobile app only/ })).toBeDisabled();
    const view = within(form).getByRole('checkbox', { name: /View people/ });
    expect(view).toBeChecked();
    expect(view).toBeDisabled();
    const name = within(form).getByRole('textbox', { name: /Name in English/ });
    await user.clear(name);
    await user.type(name, 'Owner');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    expect((writesOf(client)[0]![3] as { body: object }).body).toEqual({
      name: { en: 'Owner', hi: 'एडमिन' },
    });
  });
});
