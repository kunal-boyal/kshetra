import { ApiError } from '@thelamp/api-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, fakeClient, renderConsole } from '../test-support';

describe('the staff member’s own account (D101)', () => {
  it('changes the password with the current one and a code, showing the API’s field errors', async () => {
    let tries = 0;
    const client = fakeClient(ADMIN, (method, path) => {
      if (method === 'POST' && path === '/platform/v1/me/password' && tries++ === 0) {
        return new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
          {
            path: 'newPassword',
            issue: 'This password is known from a data breach; choose another',
          },
        ]);
      }
      return {};
    });
    renderConsole('/account', client);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Your account', level: 1 });
    const change = screen.getByRole('button', { name: 'Change password' });
    expect(change).toBeDisabled();

    await user.type(screen.getByLabelText(/^Current password/), 'a long staff password');
    await user.type(screen.getByLabelText(/^New password/), 'correct horse battery staple');
    await user.type(screen.getByLabelText(/^The password again/), 'correct horse battery stapl');
    await user.type(screen.getByLabelText(/^Authenticator code/), '123456');
    await user.click(change);
    expect(await screen.findByText('The two passwords differ')).toBeInTheDocument();
    expect(client.changePassword).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^The password again/), 'e');
    await user.click(change);
    expect(
      await screen.findByText('This password is known from a data breach; choose another'),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^New password/));
    await user.type(screen.getByLabelText(/^New password/), 'a quiet orange tractor');
    await user.clear(screen.getByLabelText(/^The password again/));
    await user.type(screen.getByLabelText(/^The password again/), 'a quiet orange tractor');
    await user.type(screen.getByLabelText(/^Authenticator code/), '654321');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your password is changed, and your other sessions have ended.',
    );
    expect(client.changePassword).toHaveBeenLastCalledWith({
      currentPassword: 'a long staff password',
      newPassword: 'a quiet orange tractor',
      code: '654321',
    });
  });
});
