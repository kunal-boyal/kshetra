import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '../../config';
import { ObjectStore } from '../../platform/object-store';
import { CONFIG } from '../../platform/tokens';

/** How long a read link lasts (spec 12.2). */
export const READ_LINK_SECONDS = 5 * 60;

/**
 * Short-lived links to read a stored object (spec 12.2, step 6): CloudFront signed URLs in AWS,
 * where the bucket is private behind it; the object store's own presigned links otherwise.
 */
@Injectable()
export class MediaUrls {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly objects: ObjectStore,
  ) {}

  /** A link that reads `key` for `seconds`, five minutes unless a caller needs longer. */
  async read(
    key: string,
    seconds = READ_LINK_SECONDS,
  ): Promise<{ url: string; expiresAt: string }> {
    const expires = new Date(Date.now() + seconds * 1000);
    const {
      CLOUDFRONT_DOMAIN: domain,
      CLOUDFRONT_KEY_ID: keyPairId,
      CLOUDFRONT_PRIVATE_KEY: privateKey,
    } = this.config;
    const url =
      domain && keyPairId && privateKey
        ? getSignedUrl({
            url: `https://${domain}/${key}`,
            keyPairId,
            privateKey,
            dateLessThan: expires.toISOString(),
            // SHA-256 rather than the default SHA-1 (decision D101).
            algorithm: 'SHA256',
          })
        : await this.objects.presignGet(key, seconds);
    return { url, expiresAt: expires.toISOString() };
  }
}
