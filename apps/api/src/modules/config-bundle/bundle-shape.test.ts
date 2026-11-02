import { ConfigBundle } from '@thelamp/forms';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BUNDLE_SHAPE } from './config-bundle.controller';

/**
 * The bundle's ETag carries `BUNDLE_SHAPE`, so an app holding a bundle of an older shape hears
 * "not modified" until the shape moves, and keeps a copy the new schema refuses: the portal then
 * shows no menus. The schema's fingerprint is held here for the current shape; a change to the
 * bundle fails this test until `BUNDLE_SHAPE` is raised and its fingerprint recorded.
 */
const FINGERPRINTS: Record<number, string> = {
  8: '294c0bbed096b2e5',
};

describe('the config bundle’s shape', () => {
  it('moves whenever the bundle schema changes', () => {
    const schema = z.toJSONSchema(ConfigBundle, { io: 'output', unrepresentable: 'any' });
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(schema))
      .digest('hex')
      .slice(0, 16);
    expect(
      FINGERPRINTS[BUNDLE_SHAPE],
      `The bundle changed: raise BUNDLE_SHAPE and record ${fingerprint} for it`,
    ).toBe(fingerprint);
  });
});
