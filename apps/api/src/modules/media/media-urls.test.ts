import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config';
import type { ObjectStore } from '../../platform/object-store';
import { MediaUrls } from './media-urls';

describe('read links', () => {
  it('are CloudFront links signed with SHA-256 in AWS (decision D101)', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const urls = new MediaUrls(
      {
        CLOUDFRONT_DOMAIN: 'media.example.test',
        CLOUDFRONT_KEY_ID: 'K2EXAMPLE',
        CLOUDFRONT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      } as Config,
      {} as ObjectStore,
    );
    const { url } = await urls.read('t/a/photo/1');
    const link = new URL(url);
    expect(link.host).toBe('media.example.test');
    expect(link.searchParams.get('Hash-Algorithm')).toBe('SHA256');
    expect(link.searchParams.get('Key-Pair-Id')).toBe('K2EXAMPLE');
  });
});
