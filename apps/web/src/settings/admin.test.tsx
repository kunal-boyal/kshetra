import { SETTING_DEFAULTS } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { accentCss } from '../brand';
import { fakeClient, renderAt, writesOf } from '../test-support';

const ADMIN = ['settings.manage', 'terminology.manage', 'module.manage'] as const;
const ORGANISATION = { name: 'Sunrise Traders', logo: null };
const saved = (body: unknown) => ({ ...SETTING_DEFAULTS, ...(body as object) });

describe('the organisation (M2)', () => {
  it('saves the details, the colour and the modules at once, and renames only when changed', async () => {
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
    await user.click(within(form).getByRole('switch', { name: /Orders/ }));
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
          modulesOff: ['orders'],
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

  it('shows the words, the field rules and the modules that cannot be switched', async () => {
    const client = fakeClient({ '/v1/organisation': ORGANISATION }, {}, ADMIN);
    renderAt('/settings/organisation', client);
    const words = await screen.findByRole('table');
    expect(within(words).getAllByRole('row')).toHaveLength(10);
    expect(screen.getByRole('link', { name: 'Change words' })).toHaveAttribute(
      'href',
      '/settings/terminology',
    );
    const rules = screen.getByRole('region', { name: 'Field rules' });
    expect(within(rules).getByText('Within 300 m')).toBeVisible();
    expect(screen.getByText('Always on')).toBeVisible();
    expect(screen.getAllByText('Arrives later')).toHaveLength(4);
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
    await user.selectOptions(screen.getByRole('combobox', { name: /^Odometer at/ }), 'required');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { geofenceRadiusMeters: 450, attendanceSelfie: true, odometer: 'required' },
    });
    expect(Object.keys((writesOf(client)[0]![3] as { body: object }).body)).toHaveLength(3);
  });
});

describe('terminology (M2, spec 5.2)', () => {
  it('saves the terms filled in every language, and keeps the product word for the rest', async () => {
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
    // Half a term is left out.
    const field = screen.getByRole('region', { name: 'Field users' });
    await user.type(within(field).getAllByRole('textbox')[0]!, 'SME');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: {
          'term.account': {
            en: { one: 'Customer', other: 'Customers' },
            hi: { one: 'ग्राहक', other: 'ग्राहक' },
          },
        },
      }),
    );
    expect(Object.keys((writesOf(client)[0]![3] as { body: object }).body)).toEqual([
      'term.account',
    ]);
  });
});

describe('modules (M2, spec 5.13)', () => {
  it('switches a module off; Core always stays, and later ones show as coming', async () => {
    const client = fakeClient({}, { 'PATCH /v1/settings': ({ body }) => saved(body) }, ADMIN);
    renderAt('/settings/modules', client);
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Modules' });
    expect(within(list).getByText('Always on')).toBeVisible();
    expect(within(list).getAllByText('Arrives later')).toHaveLength(4);
    expect(within(list).getAllByRole('checkbox', { name: 'On' })).toHaveLength(4);
    const module = (name: string) => within(within(list).getByText(name).closest('li')!);
    await user.click(module('Leave and attendance').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Orders').getByRole('checkbox', { name: 'On' }));
    await user.click(module('Account finance').getByRole('checkbox', { name: 'On' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: { modulesOff: ['leave_attendance', 'orders', 'account_finance'] },
      }),
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
