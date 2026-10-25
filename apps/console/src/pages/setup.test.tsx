import { ApiError } from '@thelamp/api-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeClient, renderConsole } from '../test-support';

afterEach(() => {
  window.location.hash = '';
});

describe('setting up from an invitation', () => {
  it('sets a password, shows the key once, and confirms with a first code', async () => {
    window.location.hash = '#invitation-secret';
    const client = fakeClient(null);
    renderConsole('/setup', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^New password/), 'a long password!');
    await user.type(screen.getByLabelText(/^The password again/), 'a different one!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('The two passwords differ')).toBeInTheDocument();
    expect(client.setUp).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^The password again/));
    await user.type(screen.getByLabelText(/^The password again/), 'a long password!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(client.setUp).toHaveBeenCalledWith('invitation-secret', 'a long password!');
    expect(await screen.findByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(
      screen.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in an authenticator app' })).toHaveAttribute(
      'href',
      'otpauth://totp/x',
    );
    await user.type(screen.getByLabelText(/^Authenticator code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Finish setting up' }));
    expect(client.confirm).toHaveBeenCalledWith('invitation-secret', '123456');
    expect(await screen.findByRole('heading', { name: 'You are set up' })).toBeInTheDocument();
  });

  it('says a spent link is spent', async () => {
    window.location.hash = '#spent';
    const client = fakeClient(null);
    client.setUp.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'x'));
    renderConsole('/setup', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^New password/), 'a long password!');
    await user.type(screen.getByLabelText(/^The password again/), 'a long password!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or been used/);
  });
});
