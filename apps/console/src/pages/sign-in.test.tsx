import { ApiError } from '@thelamp/api-client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeClient, renderConsole } from '../test-support';

describe('signing in to the console', () => {
  it('needs all three, and opens the tenants once signed in', async () => {
    const client = fakeClient(null, () => ({ items: [], nextCursor: null }));
    const { router } = renderConsole('/', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Email/), 'meera@vendor.example');
    await user.type(screen.getByLabelText(/^Password/), 'a long password');
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/^Authenticator code/), '12a3456');
    expect(screen.getByLabelText(/^Authenticator code/)).toHaveValue('123456');
    await user.click(button);
    expect(client.signIn).toHaveBeenCalledWith('meera@vendor.example', 'a long password', '123456');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Tenants' })).toBeInTheDocument();
  });

  it('says what to check, never which part was wrong', async () => {
    const client = fakeClient(null);
    client.signIn.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'x'));
    renderConsole('/sign-in', client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Email/), 'meera@vendor.example');
    await user.type(screen.getByLabelText(/^Password/), 'wrong password');
    await user.type(screen.getByLabelText(/^Authenticator code/), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check your email, password and authenticator code.',
    );
    expect(screen.getByLabelText(/^Authenticator code/)).toHaveValue('');
  });
});
