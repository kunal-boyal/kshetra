import { ApiError } from '@thelamp/api-client';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from './i18n';
import { askForStepUp, StepUpPrompt } from './step-up';

function renderPrompt() {
  render(
    <LanguageProvider>
      <StepUpPrompt />
    </LanguageProvider>,
  );
}

describe('the step-up prompt (D101)', () => {
  it('asks for a fresh code and hands it to the change waiting on it', async () => {
    renderPrompt();
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
    renderPrompt();
    const user = userEvent.setup();
    let asked!: Promise<string | null>;
    act(() => {
      asked = askForStepUp(new ApiError(400, 'OTP_INVALID', 'Wrong.'));
    });
    expect(await screen.findByRole('dialog')).toHaveTextContent(/code/i);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(asked).resolves.toBeNull();
  });

  it('declines at once when no prompt is on screen', async () => {
    await expect(askForStepUp(null)).resolves.toBeNull();
  });
});
