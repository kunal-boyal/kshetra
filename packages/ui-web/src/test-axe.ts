import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe on a rendered component. Colour contrast can't be measured in jsdom; the token tests
 * check every colour pair the design system names, in each theme.
 */
export async function expectAccessible(node: Element): Promise<void> {
  const result = await axe.run(node, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}
