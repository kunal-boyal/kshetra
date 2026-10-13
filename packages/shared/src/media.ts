import type { MediaVariant, PhotoKind } from './schemas/media';

/**
 * Photo rules (spec 12.2, BR-40) as pure functions. The server applies them after decoding a
 * photo; nothing here touches pixels' formats or storage.
 */

/** BR-40: hashes this close are the same picture... */
export const DUPLICATE_DISTANCE = 4;
/** ...among photos of the same kind taken in these last days. */
export const DUPLICATE_WINDOW_DAYS = 90;

/** The difference hash reads a 9 × 8 greyscale thumbnail: 9 across, 8 down. */
export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/**
 * A 64-bit difference hash, as 16 hexadecimal characters: for each of the 8 rows, one bit per
 * pair of neighbours, set when the left pixel is brighter than the right. Lighting and size
 * changes keep it; a different picture changes many bits.
 */
export function differenceHash(grey: Uint8Array): string {
  if (grey.length !== DHASH_WIDTH * DHASH_HEIGHT) {
    throw new Error(`A difference hash reads ${DHASH_WIDTH * DHASH_HEIGHT} pixels.`);
  }
  let bits = 0n;
  for (let row = 0; row < DHASH_HEIGHT; row += 1) {
    for (let column = 0; column < DHASH_WIDTH - 1; column += 1) {
      const left = grey[row * DHASH_WIDTH + column]!;
      const right = grey[row * DHASH_WIDTH + column + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** How many of two hashes' 64 bits differ. */
export function hammingDistance(a: string, b: string): number {
  let rest = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (rest > 0n) {
    count += Number(rest & 1n);
    rest >>= 1n;
  }
  return count;
}

/** Whether bytes start as a JPEG does. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Where a photo's variants live: `t/{tenant}/{kind}/{yyyy}/{mm}/{media}/{variant}.jpg` (spec
 * 12.2), by the month it was registered.
 */
export function photoKey(
  tenantId: string,
  kind: PhotoKind,
  mediaId: string,
  variant: MediaVariant,
  at: Date,
): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `t/${tenantId}/${kind}/${year}/${month}/${mediaId}/${variant}.jpg`;
}

/** The retention class lifecycle rules delete a photo by, from the tenant's setting (D9). */
export function photoRetentionClass(months: number): string {
  return `evidence-${months}m`;
}
