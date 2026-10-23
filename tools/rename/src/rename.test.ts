import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { followUps, plan, type Product, replacements, rewrite } from './rename.ts';

const product = JSON.parse(
  readFileSync(new URL('../../../product.json', import.meta.url), 'utf8'),
) as Product;

const before: Product = {
  ...product,
  name: 'Kshetra',
  slug: 'kshetra',
  scope: 'kshetra',
  appId: 'com.kshetra.app',
  launched: false,
};

describe('renaming the product (decision D1)', () => {
  it('moves the scope and app ID with the slug until launch', () => {
    expect(plan(before, { name: 'The Lamp', slug: 'thelamp' })).toEqual({
      next: { name: 'The Lamp', slug: 'thelamp', scope: 'thelamp', appId: 'com.thelamp.app' },
      problems: [],
    });
  });

  it('changes only the name and scope once launched', () => {
    const launched = { ...before, launched: true };
    expect(plan(launched, { name: 'Lamp' }).problems).toEqual([]);
    expect(plan(launched, { scope: 'lamp' }).problems).toEqual([]);
    expect(plan(launched, { slug: 'lamp' }).problems).toHaveLength(1);
    expect(plan(launched, { appId: 'com.lamp.app' }).problems).toHaveLength(1);
  });

  it('refuses identifiers that would not work everywhere', () => {
    // The scope and app ID follow the slug, so all three are refused.
    expect(plan(before, { slug: 'the-lamp' }).problems).toHaveLength(3);
    expect(plan(before, { name: ' ' }).problems).toHaveLength(1);
    expect(plan(before, { appId: 'thelamp' }).problems).toHaveLength(1);
  });

  it('rewrites names in one pass, outside what other services registered', () => {
    const pairs = replacements(before, {
      name: 'The Lamp',
      slug: 'thelamp',
      scope: 'thelamp',
      appId: 'com.thelamp.app',
    });
    const text = [
      "import { newId } from '@kshetra/shared';",
      "const id = 'com.kshetra.app.dev';",
      'Kshetra keeps KSHETRA_ and kshetra_refresh.',
      'See https://github.com/kunal-boyal/kshetra/pull/48 and Firebase kshetra-e3874.',
      'DATABASE_URL=postgres://kshetra:kshetra-local@localhost:5433/kshetra',
    ].join('\n');
    expect(rewrite(text, pairs, product.keep)).toBe(
      [
        "import { newId } from '@thelamp/shared';",
        "const id = 'com.thelamp.app.dev';",
        'The Lamp keeps THELAMP_ and thelamp_refresh.',
        'See https://github.com/kunal-boyal/kshetra/pull/48 and Firebase kshetra-e3874.',
        'DATABASE_URL=postgres://kshetra:kshetra-local@localhost:5433/kshetra',
      ].join('\n'),
    );
  });

  it('never renames a new name again when it holds the old one', () => {
    const pairs = replacements(before, { ...before, name: 'Kshetra One', slug: 'kshetraone' });
    expect(rewrite('Kshetra and kshetra', pairs)).toBe('Kshetra One and kshetraone');
  });

  it('lists what must change outside the repository', () => {
    const after = { name: 'The Lamp', slug: 'thelamp', scope: 'thelamp', appId: 'com.thelamp.app' };
    expect(followUps(before, after)).toHaveLength(5);
    expect(followUps(before, { ...before, name: 'The Lamp' })).toHaveLength(1);
  });
});
