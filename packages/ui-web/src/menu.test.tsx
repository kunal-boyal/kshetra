import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MenuButton } from './menu';
import { expectAccessible } from './test-axe';

function Harness() {
  return (
    <div>
      <p>Outside</p>
      <MenuButton label="Your account" trigger={<span aria-hidden="true">KD</span>}>
        {(close) => (
          <>
            <a href="/security">Security</a>
            <button type="button" onClick={close}>
              Sign out
            </button>
          </>
        )}
      </MenuButton>
    </div>
  );
}

describe('MenuButton', () => {
  it('opens its panel and says so', async () => {
    const { container } = render(<Harness />);
    const button = screen.getByRole('button', { name: 'Your account' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Security' })).toBeNull();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Security' })).toBeVisible();
    await expectAccessible(container);
  });

  it('closes on Escape and gives focus back to the button', async () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Your account' });
    await userEvent.click(button);
    screen.getByRole('link', { name: 'Security' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('closes on a click outside, and when an action in it asks', async () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Your account' });
    await userEvent.click(button);
    await userEvent.click(screen.getByText('Outside'));
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
