import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, fakeClient, renderConsole } from './test-support';

describe('the console’s frame (decision D104)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('groups the rail into customers, money and operations, with who is signed in at its foot', async () => {
    renderConsole(
      '/announcements',
      fakeClient(ADMIN, () => ({ items: [] })),
    );
    const nav = await screen.findByRole('navigation', { name: 'Console' });
    for (const section of ['Customers', 'Money', 'Operations']) {
      expect(within(nav).getByRole('list', { name: section })).toBeInTheDocument();
    }
    expect(
      within(within(nav).getByRole('list', { name: 'Customers' })).getByRole('link', {
        name: 'New tenant',
      }),
    ).toBeInTheDocument();
    expect(within(nav).getByText(ADMIN.name, { selector: '.ks-title' })).toBeInTheDocument();
    expect(within(nav).getByText(/two-step sign-in on/)).toBeInTheDocument();
  });

  it('shows which environment it serves, and nothing for a local build', async () => {
    vi.stubEnv('VITE_ENVIRONMENT', 'production');
    renderConsole(
      '/announcements',
      fakeClient(ADMIN, () => ({ items: [] })),
    );
    expect(await screen.findByText('Production')).toHaveClass('ks-badge', 'danger');
  });
});
