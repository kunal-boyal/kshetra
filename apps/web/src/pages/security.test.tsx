import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderAt, writesOf } from '../test-support';

const SETUP = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x?secret=JBSW' };

describe('sign-in security (D101)', () => {
  it('lets anyone turn an authenticator on, showing the recovery codes once', async () => {
    let enrolled = false;
    const client = fakeClient(
      {
        '/auth/v1/authenticator': () => ({ enrolled, required: false }),
      },
      {
        'POST /auth/v1/authenticator/setup': () => SETUP,
        'POST /auth/v1/authenticator/confirm': () => {
          enrolled = true;
          return { recoveryCodes: ['K7Q2M-XW4PA', 'B3C4D-E5F6G'] };
        },
      },
      ['report.view'],
    );
    renderAt('/security', client);
    const user = userEvent.setup();
    expect(
      await screen.findByText(/the portal signs you in with the SMS code alone/),
    ).toBeVisible();
    expect(screen.getByText(/someone who moves your number to a new SIM/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Set up an authenticator' }));
    expect(
      await screen.findByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    await user.type(screen.getByLabelText('Authenticator code *'), '111111');
    await user.click(screen.getByRole('button', { name: 'Turn it on' }));
    const codes = await screen.findByRole('list', { name: 'Your recovery codes' });
    expect(within(codes).getByText('K7Q2M-XW4PA')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/The authenticator is on/);
    expect(writesOf(client).map(([method, path]) => `${method} ${path}`)).toEqual([
      'POST /auth/v1/authenticator/setup',
      'POST /auth/v1/authenticator/confirm',
    ]);
  });

  it('lists where the person is signed in, and ends one or all the others (D101)', async () => {
    let live = [
      {
        id: '01a10000-0000-7000-8000-00000000f001',
        kind: 'web',
        agent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        ip: '203.0.113.7',
        startedAt: '2026-10-27T04:00:00.000Z',
        lastUsedAt: '2026-10-27T05:00:00.000Z',
        current: true,
      },
      {
        id: '01a10000-0000-7000-8000-00000000f002',
        kind: 'phone',
        agent: 'okhttp/4.12.0',
        ip: '198.51.100.4',
        startedAt: '2026-10-20T04:00:00.000Z',
        lastUsedAt: '2026-10-26T05:00:00.000Z',
        current: false,
      },
    ];
    const client = fakeClient(
      {
        '/auth/v1/authenticator': { enrolled: false, required: false },
        '/auth/v1/sessions': () => ({ items: live }),
      },
      {
        'POST /auth/v1/sessions/01a10000-0000-7000-8000-00000000f002/end': () => {
          live = live.filter((session) => session.current);
          return undefined;
        },
      },
    );
    renderAt('/security', client);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Where you’re signed in' });
    const here = await within(table).findByRole('row', { name: /Chrome on macOS/ });
    expect(within(here).getByText('This browser')).toBeVisible();
    expect(within(here).queryByRole('button', { name: 'End' })).toBeNull();
    const phone = within(table).getByRole('row', { name: /The app, on a phone/ });
    expect(within(phone).getByText('198.51.100.4')).toBeVisible();

    await user.click(within(phone).getByRole('button', { name: 'End' }));
    const confirm = screen.getByRole('group', { name: /End this session\?/ });
    await user.click(within(confirm).getByRole('button', { name: 'End' }));
    expect(await screen.findByText('That session has ended.')).toBeVisible();
    expect(within(table).queryByRole('row', { name: /The app, on a phone/ })).toBeNull();
    // With nothing else signed in, there is nothing else to end.
    expect(screen.queryByRole('button', { name: 'Sign out everywhere else' })).toBeNull();
  });

  it('keeps an admin’s on, and lets anyone else turn theirs off with a code', async () => {
    const admin = fakeClient({
      '/auth/v1/authenticator': { enrolled: true, required: true },
    });
    renderAt('/security', admin);
    expect(await screen.findByText(/Your role needs an authenticator/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Turn it off' })).toBeNull();
  });
});
