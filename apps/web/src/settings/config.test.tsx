import { todayIn } from '@thelamp/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const TYPE = {
  id: '01a10000-0000-7000-8000-000000000301',
  version: 2,
  key: 'customer',
  name: noun('Customer', 'Customers'),
  icon: 'store',
  active: true,
  parentTypes: [],
  code: { mode: 'auto', prefix: 'C' },
  fields: [{ key: 'gst_number', type: 'short_text', label: { en: 'GST number', hi: 'GST नंबर' } }],
  location: { required: true, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
  creation: 'admins',
  slots: [
    {
      key: 'executive',
      name: { en: 'Executive', hi: 'Executive' },
      designations: ['executive'],
      required: false,
      priority: 1,
    },
  ],
  segmentRules: [],
  visitFrequencyNorms: [],
  contacts: false,
};
const DESIGNATIONS = {
  items: [
    { key: 'manager', name: noun('Manager', 'Managers'), level: 2 },
    { key: 'executive', name: noun('Executive', 'Executives'), level: 3 },
  ],
};

describe('account types (M2, spec 5.5)', () => {
  it('lists the types, and adds one with a slot', async () => {
    const client = fakeClient(
      { '/v1/account-types': { items: [TYPE] }, '/v1/designations': DESIGNATIONS },
      {
        'POST /v1/account-types': ({ body }) => ({
          ...(body as { definition: object }).definition,
        }),
      },
      ['settings.manage'],
    );
    renderAt('/settings/account-types', client);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Customers' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Add a type' }));

    await user.type(await screen.findByRole('textbox', { name: /^Key/ }), 'partner');
    await user.type(screen.getByRole('textbox', { name: /Name for one, in English/ }), 'Partner');
    await user.type(screen.getByRole('textbox', { name: /Name for many, in English/ }), 'Partners');
    await user.click(screen.getByRole('button', { name: 'Add a slot' }));
    const slots = screen.getByRole('region', { name: 'Slots' });
    const [slotKey] = within(slots).getAllByRole('textbox', { name: /^Key/ });
    await user.type(slotKey!, 'owner');
    await user.type(within(slots).getByRole('textbox', { name: /Label in English/ }), 'Owner');
    await user.click(within(slots).getByRole('checkbox', { name: 'Manager' }));
    await user.click(screen.getByRole('button', { name: 'Add the type' }));

    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    const [method, path, , options] = writesOf(client)[0]!;
    expect(`${method} ${path}`).toBe('POST /v1/account-types');
    expect(options).toMatchObject({
      body: {
        id: expect.any(String),
        definition: {
          key: 'partner',
          name: noun('Partner', 'Partners'),
          code: { mode: 'manual' },
          slots: [
            {
              key: 'owner',
              name: { en: 'Owner', hi: 'Owner' },
              designations: ['manager'],
              priority: 1,
            },
          ],
          parentTypes: [],
        },
      },
    });
  });

  it('publishes the next version of a type, its key kept', async () => {
    const client = fakeClient(
      { '/v1/account-types': { items: [TYPE] }, '/v1/designations': DESIGNATIONS },
      {
        [`POST /v1/account-types/${TYPE.id}/versions`]: ({ body }) => ({
          ...TYPE,
          ...(body as { definition: object }).definition,
          version: 3,
        }),
      },
      ['settings.manage'],
    );
    renderAt(`/settings/account-types/${TYPE.id}`, client);
    const user = userEvent.setup();
    // The type's key comes first, before its fields'.
    const [key] = await screen.findAllByRole('textbox', { name: /^Key/ });
    expect(key).toHaveAttribute('readonly');
    const many = screen.getByRole('textbox', { name: /Name for many, in English/ });
    await user.clear(many);
    await user.type(many, 'Clients');
    await user.click(screen.getByRole('button', { name: 'Publish the next version' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: {
          definition: {
            key: 'customer',
            name: { en: { one: 'Customer', other: 'Clients' } },
            code: { mode: 'auto', prefix: 'C' },
            fields: [{ key: 'gst_number', type: 'short_text' }],
          },
        },
      }),
    );
  });
});

describe('territory levels (M2, spec 5.4)', () => {
  it('renames a level and adds one at the bottom; existing keys stay', async () => {
    const levels = [
      { level: 1, key: 'region', name: noun('Region', 'Regions') },
      { level: 2, key: 'area', name: noun('Area', 'Areas') },
    ];
    const client = fakeClient(
      { '/v1/territories': { items: [], levels } },
      {
        'PUT /v1/territories/levels': ({ body }) => ({
          levels: (body as { levels: object[] }).levels.map((level, index) => ({
            ...level,
            level: index + 1,
          })),
        }),
      },
      ['territory.manage'],
    );
    renderAt('/settings/territory-levels', client);
    const user = userEvent.setup();
    const keys = await screen.findAllByRole('textbox', { name: /^Key/ });
    expect(keys.map((key) => key.hasAttribute('readonly'))).toEqual([true, true]);
    const [, one] = screen.getAllByRole('textbox', { name: /Name for one, in English/ });
    await user.clear(one!);
    await user.type(one!, 'Zone');
    await user.click(screen.getByRole('button', { name: 'Add a level at the bottom' }));
    const added = screen.getAllByRole('listitem').at(-1)!;
    await user.type(within(added).getByRole('textbox', { name: /^Key/ }), 'town');
    await user.type(
      within(added).getByRole('textbox', { name: /Name for one, in English/ }),
      'Town',
    );
    await user.type(
      within(added).getByRole('textbox', { name: /Name for many, in English/ }),
      'Towns',
    );
    await user.click(screen.getByRole('button', { name: 'Save levels' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        levels: [
          { key: 'region', name: noun('Region', 'Regions') },
          { key: 'area', name: { en: { one: 'Zone', other: 'Areas' } } },
          { key: 'town', name: noun('Town', 'Towns') },
        ],
      },
    });
  });
});

const VISITS = {
  key: 'visits',
  name: noun('Visit', 'Visits'),
  unit: 'count',
  direction: 'higher_is_better',
  targetable: true,
  source: { type: 'submission_count', forms: ['visit_report'] },
};
const COVERAGE = {
  key: 'coverage',
  name: noun('Coverage', 'Coverage'),
  unit: 'percent',
  direction: 'higher_is_better',
  targetable: true,
  source: { type: 'coverage_percent', forms: ['visit_report'] },
};
const DEFINITIONS = {
  metrics: [
    { definition: VISITS, active: true, version: 1 },
    { definition: COVERAGE, active: true, version: 1 },
  ],
  score: {
    periodType: 'month',
    cap: 1,
    rankingGroupBy: 'designation',
    metrics: [{ metric: 'visits', weight: 100 }],
  },
};
const PAGES = {
  '/v1/metric-definitions': DEFINITIONS,
  '/v1/forms': { items: [{ key: 'visit_report', name: noun('Visit report', 'Visit reports') }] },
  '/v1/account-types': { items: [TYPE] },
  '/v1/roles': { items: [{ key: 'manager', name: { en: 'Manager', hi: 'Manager' } }] },
};

describe('metrics and the score (M2, spec 5.7, 5.8)', () => {
  it('changes a metric with its unit kept, working facts out again from today', async () => {
    const client = fakeClient(PAGES, { 'PUT /v1/metrics/visits': () => DEFINITIONS }, [
      'metric.manage',
    ]);
    renderAt('/settings/metrics', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Visits' }));
    expect(await screen.findByRole('combobox', { name: /^Unit/ })).toBeDisabled();
    const many = screen.getByRole('textbox', { name: /Name for many, in English/ });
    await user.clear(many);
    await user.type(many, 'Calls');
    await user.click(screen.getByRole('button', { name: 'Save and work out again' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toMatchObject({
        body: {
          definition: {
            key: 'visits',
            unit: 'count',
            name: { en: { other: 'Calls' } },
            source: { type: 'submission_count', forms: ['visit_report'] },
          },
          active: true,
          from: todayIn('Asia/Kolkata'),
        },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Metrics' })).toBeVisible();
  });

  it('adds a metric that sends only what its source asks for', async () => {
    const client = fakeClient(PAGES, { 'POST /v1/metrics': () => DEFINITIONS }, ['metric.manage']);
    renderAt('/settings/metrics/new', client);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: /^Key/ }), 'call_ratio');
    await user.type(screen.getByRole('textbox', { name: /Name for one, in English/ }), 'Ratio');
    await user.type(screen.getByRole('textbox', { name: /Name for many, in English/ }), 'Ratios');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Unit/ }), 'percent');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Source' }),
      'One metric divided by another',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Divide' }), 'Visits');
    await user.selectOptions(screen.getByRole('combobox', { name: 'By' }), 'Coverage');
    await user.click(screen.getByRole('button', { name: 'Add the metric' }));
    await waitFor(() =>
      expect(writesOf(client)[0]![3]).toEqual(
        expect.objectContaining({
          body: {
            definition: {
              key: 'call_ratio',
              name: noun('Ratio', 'Ratios'),
              unit: 'percent',
              direction: 'higher_is_better',
              targetable: true,
              source: { type: 'ratio', numerator: 'visits', denominator: 'coverage' },
            },
          },
        }),
      ),
    );
  });

  it('weighs metrics into the score, monthly', async () => {
    const client = fakeClient(PAGES, { 'PUT /v1/score': () => DEFINITIONS }, ['metric.manage']);
    renderAt('/settings/metrics', client);
    const user = userEvent.setup();
    const score = await screen.findByRole('region', { name: 'The score' });
    const weight = within(score).getByRole('spinbutton', { name: 'Weight of Visits' });
    await user.clear(weight);
    await user.type(weight, '60');
    await user.selectOptions(
      within(score).getByRole('combobox', { name: 'Add a metric to the score' }),
      'Coverage',
    );
    const coverage = within(score).getByRole('spinbutton', { name: 'Weight of Coverage' });
    await user.clear(coverage);
    await user.type(coverage, '40');
    expect(within(score).getByText('Weights add up to 100.')).toBeVisible();
    await user.click(within(score).getByRole('button', { name: 'Save the score' }));
    expect(await within(score).findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        definition: {
          periodType: 'month',
          cap: 1,
          metrics: [
            { metric: 'visits', weight: 60 },
            { metric: 'coverage', weight: 40 },
          ],
        },
      },
    });
  });
});
