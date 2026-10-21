import { SETTING_DEFAULTS } from '@kshetra/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { accentCss } from '../brand';
import { fakeClient, renderAt, writesOf } from '../test-support';

const ADMIN = ['settings.manage', 'terminology.manage', 'module.manage'] as const;
const ORGANISATION = { name: 'Sunrise Traders', logo: null };
const saved = (body: unknown) => ({ ...SETTING_DEFAULTS, ...(body as object) });

describe('the organisation (M2)', () => {
  it('saves the legal details, and renames only when the name changed', async () => {
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
    const form = await screen.findByRole('form', { name: 'Name and legal details' });
    await user.type(
      within(form).getByRole('textbox', { name: 'Legal name' }),
      'Sunrise Traders Pvt Ltd',
    );
    await user.type(within(form).getByRole('textbox', { name: /GSTIN/ }), '07abcde1234f1z5');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form.parentElement!).findByText('Saved.')).toBeVisible();
    expect(writesOf(client).map(([method, path]) => `${method} ${path}`)).toEqual([
      'PATCH /v1/settings',
    ]);
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { legalName: 'Sunrise Traders Pvt Ltd', address: null, taxId: '07ABCDE1234F1Z5' },
    });
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
    expect(screen.getByRole('button', { name: 'Use this colour' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Use #[0-9a-f]{6} instead/ }));
    expect(screen.queryByText(/Too light/)).toBeNull();
    expect(screen.getByRole('group', { name: 'How it looks' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Use this colour' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: { brandColour: expect.stringMatching(/^#[0-9a-f]{6}$/) },
      }),
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: { geofenceRadiusMeters: 450, attendanceSelfie: true },
    });
    expect(Object.keys((writesOf(client)[0]![3] as { body: object }).body)).toHaveLength(2);
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
    expect(within(list).getAllByText('Arrives later').length).toBeGreaterThan(3);
    await user.click(within(list).getByRole('checkbox', { name: 'On' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({ body: { modulesOff: ['leave_attendance'] } }),
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
