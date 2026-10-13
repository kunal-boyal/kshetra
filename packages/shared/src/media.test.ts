import { describe, expect, it } from 'vitest';
import {
  differenceHash,
  DUPLICATE_DISTANCE,
  hammingDistance,
  isJpeg,
  photoKey,
  photoRetentionClass,
} from './media';

/** A 9 × 8 picture from a brightness at each column and row. */
const picture = (shade: (column: number, row: number) => number) =>
  Uint8Array.from({ length: 72 }, (_, index) => shade(index % 9, Math.floor(index / 9)));

describe('photos (spec 12.2, BR-40)', () => {
  it('hashes the same picture the same way when it is lighter or darker', () => {
    const scene = (column: number, row: number) => (column * 37 + row * 11) % 200;
    const hash = differenceHash(picture(scene));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(differenceHash(picture((c, r) => scene(c, r) + 40))).toBe(hash);
    expect(hammingDistance(hash, hash)).toBe(0);
  });

  it('tells a different picture apart, and a slightly changed one not', () => {
    const fading = picture((column) => 200 - column * 20);
    const rising = picture((column) => column * 20);
    expect(differenceHash(fading)).toBe('ffffffffffffffff');
    expect(differenceHash(rising)).toBe('0000000000000000');
    expect(hammingDistance(differenceHash(fading), differenceHash(rising))).toBe(64);

    const touched = picture((column, row) => (row === 0 && column === 1 ? 250 : 200 - column * 20));
    expect(hammingDistance(differenceHash(fading), differenceHash(touched))).toBeLessThanOrEqual(
      DUPLICATE_DISTANCE,
    );
  });

  it('knows a JPEG by its first bytes', () => {
    expect(isJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it('keeps variants under the tenant, kind and month, and retention by the setting', () => {
    expect(photoKey('t1', 'evidence', 'm1', 'thumbnail', new Date('2026-10-12T10:00:00Z'))).toBe(
      't/t1/evidence/2026/10/m1/thumbnail.jpg',
    );
    expect(photoRetentionClass(12)).toBe('evidence-12m');
  });
});
