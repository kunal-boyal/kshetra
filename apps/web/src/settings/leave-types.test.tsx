import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const CASUAL = {
  key: 'casual',
  name: { en: 'Casual leave', hi: 'आकस्मिक अवकाश' },
  paid: true,
  annualQuota: 12,
  quotaYear: 'calendar',
  halfDayAllowed: true,
  active: true,
};

describe('leave types (M13, spec 5.10)', () => {
  it('keeps a saved key, adds a type, and sends the whole list', async () => {
    const client = fakeClient(
      { '/v1/leave-types': { items: [CASUAL] } },
      { 'PUT /v1/leave-types': ({ body }) => body },
      ['leave_type.manage'],
    );
    renderAt('/settings/leave-types', client);
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Leave types' });
    const cards = () => within(list).getAllByRole('listitem');
    const casual = cards()[0]!;
    expect(within(casual).getByRole('textbox', { name: /^Key/ })).toHaveAttribute('readonly');
    const quota = within(casual).getByRole('textbox', { name: /^Days a year/ });
    await user.clear(quota);
    await user.type(quota, '15');
    await user.type(
      within(casual).getByRole('textbox', { name: /^A document is needed after/ }),
      '2',
    );

    await user.click(screen.getByRole('button', { name: 'Add a leave type' }));
    const study = cards()[1]!;
    await user.type(within(study).getByRole('textbox', { name: /^Key/ }), 'study');
    await user.type(
      within(study).getByRole('textbox', { name: /^Name in English/ }),
      'Study leave',
    );
    await user.selectOptions(
      within(study).getByRole('combobox', { name: 'The year runs' }),
      'financial',
    );
    await user.click(within(study).getByRole('checkbox', { name: /^Half days allowed/ }));
    await user.click(screen.getByRole('button', { name: 'Save leave types' }));

    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(writesOf(client)[0]![3]).toMatchObject({
      body: {
        items: [
          { ...CASUAL, annualQuota: 15, attachmentAfterDays: 2 },
          {
            key: 'study',
            name: { en: 'Study leave', hi: 'Study leave' },
            paid: true,
            annualQuota: 0,
            quotaYear: 'financial',
            halfDayAllowed: false,
            active: true,
          },
        ],
      },
    });
    // Saved, the new type's key is kept too.
    expect(within(cards()[1]!).getByRole('textbox', { name: /^Key/ })).toHaveAttribute('readonly');
  });
});
