import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Nobody signed in: the cookie gives no session, as for anyone following a store listing's link. */
async function signedOut(page: Page) {
  await page.route('**/auth/v1/token/refresh', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_REVOKED', message: 'Sign in.', requestId: 'r' } },
    }),
  );
}

/** WCAG 2.1 A and AA, which every screen must pass. */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id} at ${node.target.join(' ')}: ${node.failureSummary}`,
    ),
  );
  expect(found).toEqual([]);
}

test('the privacy notice is public, stays put without a session, and passes axe', async ({
  page,
}) => {
  await signedOut(page);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is never recorded' })).toBeVisible();
  await expect(page).toHaveURL(/\/privacy$/);
  await expectAccessible(page);

  await page.getByRole('combobox').selectOption('hi');
  await expect(page.getByRole('heading', { level: 1, name: 'निजता सूचना' })).toBeVisible();
  await expectAccessible(page);
});

test('the account deletion page is public, links from sign-in, and passes axe', async ({
  page,
}) => {
  await signedOut(page);
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Deleting your account' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Deleting your account and data' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/delete-account$/);
  await expectAccessible(page);
});
