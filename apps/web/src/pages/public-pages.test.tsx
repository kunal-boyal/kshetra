import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { WebClient } from '../client';
import { LanguageProvider } from '../i18n';
import { createAppRouter } from '../router';

/** Nobody signed in: the public pages ask the API for nothing. */
function renderSignedOut(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = { session: null } as unknown as WebClient;
  const router = createAppRouter({ client, queryClient });
  const memory = createRouter({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RouterProvider router={memory} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return memory;
}

describe('the public pages (spec 13.3, decision D100)', () => {
  it('shows the privacy notice to anyone, in every section', async () => {
    renderSignedOut('/privacy');
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    for (const section of [
      'Who is responsible',
      'What is recorded',
      'What is never recorded',
      'What it is used for',
      'Who sees it',
      'Where and for how long',
      'Your rights',
      'Security',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
    expect(screen.getByText(/only while you are on duty/)).toBeVisible();
    // Without a privacy address in the build, the notice points to the store page.
    expect(screen.getByText(/at the address on the app’s store page/)).toBeVisible();
  });

  it('says how to have an account deleted, and links to the notice', async () => {
    const router = renderSignedOut('/delete-account');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Deleting your account and data' }),
    ).toBeVisible();
    expect(
      screen.getByText('In the app: Me › My data › Erasing my data › Send request.'),
    ).toBeVisible();
    expect(screen.getByText(/what is deleted and what is kept/i)).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Read the privacy notice' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/privacy');
  });
});
