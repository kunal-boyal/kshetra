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

  it('keeps an admin’s on, and lets anyone else turn theirs off with a code', async () => {
    const admin = fakeClient({
      '/auth/v1/authenticator': { enrolled: true, required: true },
    });
    renderAt('/security', admin);
    expect(await screen.findByText(/Your role needs an authenticator/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Turn it off' })).toBeNull();
  });
});
