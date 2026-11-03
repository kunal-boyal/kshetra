import { ApiError } from '@thelamp/api-client';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { askForStepUp } from './step-up';
import { fakeClient, renderAt } from './test-support';

const NOTIFICATIONS = { items: [], nextCursor: null, unread: 0 };

/** The portal's frame, which holds the prompt, for someone with an authenticator or none. */
async function renderPrompt(enrolled = true) {
  const router = renderAt(
    '/notifications',
    fakeClient({
      '/v1/notifications': NOTIFICATIONS,
      '/auth/v1/authenticator': { enrolled, required: false },
    }),
  );
  await screen.findByRole('link', { name: 'Home' });
  return router;
}

describe('the step-up prompt (D101)', () => {
  it('asks for a fresh code and hands it to the change waiting on it', async () => {
    await renderPrompt();
    const user = userEvent.setup();
    let asked!: Promise<string | null>;
    act(() => {
      asked = askForStepUp(null);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(dialog).toHaveTextContent('decides who can sign in as whom');
    const field = screen.getByLabelText(/Authenticator code/);
    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.type(field, '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await expect(asked).resolves.toBe('123456');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a code was wrong, and gives nothing when cancelled', async () => {
    await renderPrompt();
    const user = userEvent.setup();
    let asked!: Promise<string | null>;
    act(() => {
      asked = askForStepUp(new ApiError(400, 'OTP_INVALID', 'Wrong.'));
    });
    expect(await screen.findByRole('dialog')).toHaveTextContent(/code/i);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(asked).resolves.toBeNull();
  });

  it('sends someone with no authenticator to set one up, asking for no code', async () => {
    const router = await renderPrompt(false);
    const user = userEvent.setup();
    let asked!: Promise<string | null>;
    act(() => {
      asked = askForStepUp(null);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(await within(dialog).findByText(/you have none set up/)).toBeVisible();
    expect(within(dialog).queryByLabelText(/Authenticator code/)).toBeNull();
    await user.click(within(dialog).getByRole('link', { name: 'Set up an authenticator' }));
    await expect(asked).resolves.toBeNull();
    expect(router.state.location.pathname).toBe('/security');
  });

  it('says the same when the server finds no authenticator behind a code', async () => {
    await renderPrompt();
    act(() => {
      void askForStepUp(
        new ApiError(409, 'CONFLICT', 'Set up an authenticator first.', [
          { path: 'authenticator', issue: 'No authenticator is set up' },
        ]),
      );
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/you have none set up/)).toBeVisible();
    expect(within(dialog).queryByText(/changed somewhere else/)).toBeNull();
  });

  it('declines at once when no prompt is on screen', async () => {
    await expect(askForStepUp(null)).resolves.toBeNull();
  });
});
