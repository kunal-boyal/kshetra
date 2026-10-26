import { ApiError } from '@thelamp/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, noun, renderAt, writesOf } from '../test-support';

const VISIT = '01a10000-0000-7000-8000-0000000000a0';
const SURVEY = '01a10000-0000-7000-8000-0000000000a1';
const text = (en: string) => ({ en, hi: en });

const MANAGE = ['form.manage', 'settings.manage'] as const;

const VISIT_FORM = {
  id: VISIT,
  version: 2,
  active: true,
  key: 'shop_visit',
  name: noun('Shop visit', 'Shop visits'),
  icon: 'clipboard-list',
  tags: [],
  accountLink: { mode: 'required', accountTypes: ['shop'] },
  visitSession: true,
  shift: 'required',
  photos: { min: 1, max: 3, source: 'camera' },
  signature: 'none',
  geofence: 'inherit',
  review: 'manual',
  fields: [
    { key: 'stock_ok', type: 'yes_no', label: text('Stock is fine'), required: true },
    {
      key: 'shortfall',
      type: 'long_text',
      label: text('What is short'),
      required: false,
      visibleWhen: { match: 'all', clauses: [{ field: 'stock_ok', op: 'eq', value: false }] },
    },
  ],
};
const SURVEY_FORM = {
  ...VISIT_FORM,
  id: SURVEY,
  version: 1,
  active: false,
  key: 'survey',
  name: noun('Survey', 'Surveys'),
  accountLink: { mode: 'none' },
  visitSession: false,
  fields: [{ key: 'notes', type: 'long_text', label: text('Notes'), required: false }],
};

const SHOP_TYPE = {
  id: '01a10000-0000-7000-8000-000000000070',
  version: 1,
  key: 'shop',
  name: noun('Shop', 'Shops'),
  icon: 'store',
  active: true,
  parentTypes: [],
  code: { mode: 'manual' },
  fields: [],
  location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
  creation: 'admins_only',
  slots: [],
  segmentRules: [],
  visitFrequencyNorms: [],
  contacts: false,
};

const PAGES = {
  '/v1/forms': { items: [VISIT_FORM, SURVEY_FORM] },
  '/v1/roles': { items: [] },
  '/v1/designations': { items: [] },
};
const BUNDLE = { accountTypes: [SHOP_TYPE] };

describe('the phone preview', () => {
  it('shows the form as a phone would, following its conditions, in either language', async () => {
    const client = fakeClient(PAGES, {}, MANAGE, BUNDLE);
    renderAt(`/settings/forms/${VISIT}`, client);
    const phone = await screen.findByRole('region', { name: 'On the phone' });
    expect(within(phone).getByText('Shop visit')).toBeVisible();
    expect(within(phone).queryByRole('textbox', { name: 'What is short' })).toBeNull();
    const user = userEvent.setup();
    await user.selectOptions(
      within(phone).getByRole('combobox', { name: 'Stock is fine *' }),
      'no',
    );
    expect(within(phone).getByRole('textbox', { name: 'What is short' })).toBeVisible();
    expect(within(phone).getByText('Photos *')).toBeVisible();
    await user.selectOptions(within(phone).getByRole('combobox', { name: 'Language' }), 'hi');
    expect(within(phone).getByRole('textbox', { name: 'What is short' })).toBeVisible();
  });
});

describe('forms', () => {
  it('lists every form with its version, and switches one off', async () => {
    const client = fakeClient(
      PAGES,
      { [`PATCH /v1/forms/${VISIT}`]: ({ body }) => ({ ...VISIT_FORM, ...(body as object) }) },
      MANAGE,
      BUNDLE,
    );
    renderAt('/settings/forms', client);
    const table = await screen.findByRole('table', { name: 'Forms, in use and switched off' });
    const visit = within(table).getByRole('row', { name: /Shop visit/ });
    expect(visit).toHaveTextContent('In use');
    expect(within(table).getByRole('row', { name: /Survey/ })).toHaveTextContent('Switched off');

    const user = userEvent.setup();
    await user.click(within(visit).getByRole('button', { name: 'Switch off Shop visit' }));
    await waitFor(() =>
      expect(writesOf(client)).toEqual([
        [
          'PATCH',
          `/v1/forms/${VISIT}`,
          expect.anything(),
          expect.objectContaining({ body: { active: false } }),
        ],
      ]),
    );
  });

  it('builds a form with a condition on an earlier field, and publishes version 1', async () => {
    const held: object[] = [];
    const client = fakeClient(
      { ...PAGES, '/v1/forms': () => ({ items: held }) },
      {
        'POST /v1/forms': ({ body }) => {
          const form = {
            ...(body as { definition: object }).definition,
            id: SURVEY,
            version: 1,
            active: true,
          };
          held.push(form);
          return form;
        },
      },
      MANAGE,
      BUNDLE,
    );
    renderAt('/settings/forms/new', client);
    // Much typing: no pause between keys.
    const user = userEvent.setup({ delay: null });
    const basics = await screen.findByRole('region', { name: 'About the form' });
    await user.type(within(basics).getByRole('textbox', { name: 'Key*' }), 'shop_check');
    await user.type(
      within(basics).getByRole('textbox', { name: 'Name in English, one*' }),
      'Shop check',
    );
    await user.type(
      within(basics).getByRole('textbox', { name: 'Name in English, several*' }),
      'Shop checks',
    );

    // The first field is there to start with; it becomes a yes-or-no question's sibling.
    const first = screen.getByRole('region', { name: 'Field field_1' });
    await user.click(within(first).getByRole('button', { name: 'Edit' }));
    await user.type(within(first).getByRole('textbox', { name: 'Label in English' }), 'Owner');
    // The card stays open while its key is typed.
    const key = within(first).getByRole('textbox', { name: 'Key' });
    await user.clear(key);
    await user.type(key, 'owner');
    expect(within(first).getByRole('textbox', { name: 'Key' })).toHaveValue('owner');

    await user.selectOptions(screen.getByRole('combobox', { name: 'New field type' }), 'yes_no');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const second = screen.getByRole('region', { name: 'Field field_2' });
    await user.type(
      within(second).getByRole('textbox', { name: 'Label in English' }),
      'Open today',
    );
    await user.click(within(second).getByRole('checkbox', { name: 'Must be filled' }));

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'New field type' }),
      'single_select',
    );
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const third = screen.getByRole('region', { name: 'Field field_3' });
    await user.type(within(third).getByRole('textbox', { name: 'Label in English' }), 'Why closed');
    await user.type(
      within(third).getByRole('textbox', { name: 'Choices' }),
      'holiday | Holiday | छुट्टी{enter}moved | Moved',
    );
    await user.click(within(third).getByRole('button', { name: 'Show only when…' }));
    await user.selectOptions(within(third).getByRole('combobox', { name: 'Field' }), 'field_2');
    await user.selectOptions(within(third).getByRole('combobox', { name: 'Value' }), 'no');

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(writesOf(client)).toHaveLength(1));
    const [, path, , options] = writesOf(client)[0]!;
    expect(path).toBe('/v1/forms');
    expect((options as { body: { definition: object } }).body.definition).toMatchObject({
      key: 'shop_check',
      name: { en: { one: 'Shop check', other: 'Shop checks' }, hi: { one: 'Shop check' } },
      fields: [
        { key: 'owner', type: 'short_text', label: { en: 'Owner', hi: 'Owner' } },
        { key: 'field_2', type: 'yes_no', required: true },
        {
          key: 'field_3',
          type: 'single_select',
          options: [
            { key: 'holiday', label: { en: 'Holiday', hi: 'छुट्टी' } },
            { key: 'moved', label: { en: 'Moved', hi: 'Moved' } },
          ],
          visibleWhen: { match: 'all', clauses: [{ field: 'field_2', op: 'eq', value: false }] },
        },
      ],
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Shop check' })).toBeVisible();
  }, 20_000);

  it('asks for a signature when the visit took an order, and lists items without quantities', async () => {
    const client = fakeClient(
      PAGES,
      {
        [`POST /v1/forms/${VISIT}/versions`]: ({ body }) => ({
          ...VISIT_FORM,
          ...(body as { definition: object }).definition,
          version: 3,
        }),
      },
      MANAGE,
      BUNDLE,
    );
    renderAt(`/settings/forms/${VISIT}`, client);
    const user = userEvent.setup({ delay: null });
    expect(await screen.findByRole('heading', { level: 1, name: 'Shop visit' })).toBeVisible();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'New field type' }),
      'product_lines',
    );
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const lines = screen.getByRole('region', { name: 'Field field_3' });
    await user.type(
      within(lines).getByRole('textbox', { name: 'Label in English' }),
      'Products shown',
    );
    await user.click(within(lines).getByRole('checkbox', { name: /A quantity on each line/ }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Signature' }), 'optional');
    await user.click(screen.getByRole('button', { name: 'Require it only when…' }));
    const when = screen.getByRole('group', { name: 'Required only when' });
    await user.selectOptions(
      within(when).getByRole('combobox', { name: 'Field' }),
      'visit_ordered',
    );
    await user.selectOptions(within(when).getByRole('combobox', { name: 'Value' }), 'yes');

    // The preview tries it both ways.
    const phone = screen.getByRole('region', { name: 'On the phone' });
    expect(within(phone).getByText('Signature')).toBeVisible();
    expect(within(phone).getByText('Items from the catalogue, without quantities')).toBeVisible();
    await user.click(within(phone).getByRole('checkbox', { name: 'Orders taken in the visit' }));
    expect(within(phone).getByText('Signature *')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Publish the next version' }));
    expect(await screen.findByText('Version 3 is published.')).toBeVisible();
    const [, , , options] = writesOf(client)[0]!;
    expect((options as { body: { definition: object } }).body.definition).toMatchObject({
      signature: 'optional',
      signatureRequiredWhen: {
        match: 'all',
        clauses: [{ field: 'visit_ordered', op: 'eq', value: true }],
      },
      fields: [
        { key: 'stock_ok' },
        { key: 'shortfall' },
        { key: 'field_3', type: 'product_lines', quantities: false },
      ],
    });

    // A signature always or never needed takes no condition.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Signature' }), 'required');
    expect(screen.queryByRole('group', { name: 'Required only when' })).toBeNull();
  }, 20_000);

  it('publishes the next version, and shows refusals on the field they concern', async () => {
    let calls = 0;
    const client = fakeClient(
      PAGES,
      {
        [`POST /v1/forms/${VISIT}/versions`]: ({ body }) => {
          calls += 1;
          if (calls === 1) {
            throw new ApiError(422, 'VALIDATION', 'Check the highlighted fields.', [
              {
                path: 'definition.fields[1].visibleWhen.clauses[0].field',
                issue: 'There is no field `stock_ok`',
              },
            ]);
          }
          return { ...VISIT_FORM, ...(body as { definition: object }).definition, version: 3 };
        },
      },
      MANAGE,
      BUNDLE,
    );
    renderAt(`/settings/forms/${VISIT}`, client);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Shop visit' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Key*' })).toHaveAttribute('readonly');

    const stock = screen.getByRole('region', { name: 'Field Stock is fine' });
    await user.click(within(stock).getByRole('button', { name: 'Edit' }));
    expect(within(stock).getByRole('textbox', { name: 'Key' })).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: 'Publish the next version' }));
    const shortfall = await screen.findByRole('region', { name: 'Field What is short' });
    expect(within(shortfall).getByRole('alert')).toHaveTextContent('There is no field `stock_ok`');
    expect(within(shortfall).getByRole('group', { name: 'Show only when' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Publish the next version' }));
    expect(await screen.findByText('Version 3 is published.')).toBeVisible();
    const [, path] = writesOf(client)[1]!;
    expect(path).toBe(`/v1/forms/${VISIT}/versions`);
  });
});
