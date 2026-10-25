import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderConsole, TENANT } from '../test-support';

const SHOWING = {
  id: '01a10000-0000-7000-8000-0000000000d1',
  title: { en: 'Planned maintenance', hi: 'तय रखरखाव' },
  body: { en: 'Down from 11 pm to midnight.', hi: 'रात 11 से 12 बजे तक बंद।' },
  tone: 'warning' as const,
  surfaces: ['web' as const, 'mobile' as const],
  tenants: null,
  startsAt: '2026-10-26T04:00:00.000Z',
  endsAt: '2099-10-27T04:00:00.000Z',
  status: 'showing' as const,
  createdBy: 'Meera Iyer',
  createdAt: '2026-10-26T03:50:00.000Z',
  withdrawnAt: null,
};

const SUPPORT = {
  ...ADMIN,
  role: 'support' as const,
  permissions: ['platform.support.request' as const],
};

describe('announcements in the console (M22, D93)', () => {
  it('lists what was announced, and withdraws one after asking', async () => {
    let items = [SHOWING];
    const client = fakeClient(ADMIN, (method, path) => {
      if (method === 'POST' && path.endsWith('/withdraw')) {
        items = [{ ...SHOWING, status: 'withdrawn' as never }];
        return items[0];
      }
      return { items };
    });
    renderConsole('/announcements', client);
    const table = await screen.findByRole('table', { name: 'Announcements' });
    const row = within(table).getByRole('row', { name: /Planned maintenance/ });
    expect(row).toHaveTextContent('Warning');
    expect(row).toHaveTextContent('Web portal, Phones');
    expect(row).toHaveTextContent('Every tenant');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('group', {
      name: 'Take “Planned maintenance” down now? Nobody sees it any more.',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    expect(await within(table).findByText('Withdrawn')).toBeVisible();
  });

  it('announces to chosen tenants, in both languages, under one ID', async () => {
    const client = fakeClient(ADMIN, (method, path, body) => {
      if (method === 'POST') return { ...SHOWING, ...(body as object), status: 'scheduled' };
      if (path.startsWith('/platform/v1/tenants')) return { items: [TENANT], nextCursor: null };
      return { items: [] };
    });
    renderConsole('/announcements', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Title in English/), 'New reports');
    await user.type(screen.getByLabelText(/^Title in Hindi/), 'नई रिपोर्टें');
    await user.type(screen.getByLabelText(/^Message in English/), 'Visit reports are faster.');
    await user.type(screen.getByLabelText(/^Message in Hindi/), 'विज़िट रिपोर्टें तेज़ हैं।');
    await user.click(screen.getByRole('checkbox', { name: 'Phones' }));
    await user.selectOptions(screen.getByLabelText('Who'), 'some');
    const send = screen.getByRole('button', { name: 'Announce' });
    expect(send).toBeDisabled();
    await user.click(await screen.findByRole('checkbox', { name: 'Sunrise Agro' }));
    await user.click(send);
    expect(await screen.findByText('Announced.')).toBeVisible();
    const [, , , sent] = client.request.mock.calls.find(([method]) => method === 'POST')!;
    expect(sent).toMatchObject({
      title: { en: 'New reports', hi: 'नई रिपोर्टें' },
      tone: 'info',
      surfaces: ['web'],
      tenantIds: [TENANT.id],
    });
  });

  it('lets other staff read, not announce', async () => {
    renderConsole(
      '/announcements',
      fakeClient(SUPPORT, () => ({ items: [SHOWING] })),
    );
    expect(await screen.findByRole('table', { name: 'Announcements' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New announcement' })).not.toBeInTheDocument();
  });
});
