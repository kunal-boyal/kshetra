import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeClient, renderAt } from '../test-support';

const ANNOUNCEMENTS = {
  items: [
    {
      id: '01a10000-0000-7000-8000-0000000000d1',
      title: { en: 'Planned maintenance', hi: 'तय रखरखाव' },
      body: { en: 'Down from 11 pm to midnight.', hi: 'रात 11 से 12 बजे तक बंद।' },
      tone: 'warning',
      endsAt: '2099-10-27T04:00:00.000Z',
    },
    {
      id: '01a10000-0000-7000-8000-0000000000d2',
      title: { en: 'New reports', hi: 'नई रिपोर्टें' },
      body: { en: 'Visit reports are faster.', hi: 'विज़िट रिपोर्टें तेज़ हैं।' },
      tone: 'info',
      endsAt: '2099-10-27T04:00:00.000Z',
    },
  ],
};

describe('announcements in the portal (M22, D93)', () => {
  afterEach(() => localStorage.clear());

  it('shows what the vendor announces above every screen, until dismissed in this browser', async () => {
    const client = fakeClient(
      { '/v1/announcements?surface=web': ANNOUNCEMENTS, '/v1/support-grants': { items: [] } },
      {},
      ['settings.manage'],
    );
    renderAt('/settings/support', client);
    const region = await screen.findByRole('region', { name: 'Announcements' });
    expect(within(region).getByText('Planned maintenance')).toBeVisible();
    expect(within(region).getByText('Visit reports are faster.')).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(region).getByRole('button', { name: 'Dismiss “Planned maintenance”' }));
    expect(within(region).queryByText('Planned maintenance')).not.toBeInTheDocument();
    expect(within(region).getByText('New reports')).toBeVisible();
    expect(localStorage.getItem('announcements.dismissed')).toContain(ANNOUNCEMENTS.items[0]!.id);
  });
});
