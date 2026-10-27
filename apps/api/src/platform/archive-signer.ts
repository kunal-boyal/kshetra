import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ARCHIVE_MANIFEST,
  ARCHIVE_SIGNATURE,
  ArchiveManifest,
  archiveKeyId,
} from '@thelamp/shared';
import { unzipSync } from 'fflate';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/** PKCS#8's wrapping of a 32-byte Ed25519 seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The Ed25519 private key a 32-byte seed stands for. */
export function archivePrivateKey(seed: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** A public key's ID, as archives name it. */
export function publicKeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return archiveKeyId(createHash('sha256').update(der).digest('hex'));
}

/**
 * Signs tenant archives (decision D95) with the cell's Ed25519 key, from `ARCHIVE_SIGNING_KEY`.
 * Production needs it where archives are made or their key shown; it is read when first needed,
 * so a process that does neither holds none (decision D101). Elsewhere, without one, the seed is
 * derived from `OTP_PEPPER`, so a local archive still checks out after a restart.
 */
@Injectable()
export class ArchiveSigner {
  private key: { privateKey: KeyObject; publicKeyPem: string; keyId: string } | undefined;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  private loaded() {
    if (this.key) return this.key;
    let seed: Buffer;
    if (this.config.ARCHIVE_SIGNING_KEY) {
      seed = Buffer.from(this.config.ARCHIVE_SIGNING_KEY, 'base64');
    } else if (this.config.NODE_ENV !== 'production' && this.config.OTP_PEPPER) {
      new Logger(ArchiveSigner.name).warn('No ARCHIVE_SIGNING_KEY: deriving one from OTP_PEPPER.');
      seed = Buffer.from(
        hkdfSync('sha256', this.config.OTP_PEPPER, 'archive-signing', 'local', 32),
      );
    } else {
      throw new Error('This process holds no ARCHIVE_SIGNING_KEY.');
    }
    const privateKey = archivePrivateKey(seed);
    const publicKey = createPublicKey(privateKey);
    this.key = {
      privateKey,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      keyId: publicKeyId(publicKey),
    };
    return this.key;
  }

  get publicKeyPem(): string {
    return this.loaded().publicKeyPem;
  }

  get keyId(): string {
    return this.loaded().keyId;
  }

  /** The signature of a manifest's bytes, in base64. */
  sign(manifest: Uint8Array): string {
    return sign(null, manifest, this.loaded().privateKey).toString('base64');
  }
}

export class ArchiveInvalid extends Error {}

/**
 * The manifest of an archive, once it checks out: its signature is the given public key's over
 * the manifest's bytes, and the archive holds exactly the files the manifest lists, each with its
 * size and SHA-256. Anything else throws `ArchiveInvalid`, saying what is wrong.
 */
export function verifyArchive(archive: Uint8Array, publicKeyPem: string): ArchiveManifest {
  return readArchive(archive, publicKeyPem).manifest;
}

/** A checked archive's manifest and its entries, by path; see `verifyArchive`. */
export function readArchive(
  archive: Uint8Array,
  publicKeyPem: string,
): { manifest: ArchiveManifest; entries: Record<string, Uint8Array> } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive);
  } catch {
    throw new ArchiveInvalid('This is not a ZIP archive.');
  }
  const manifestBytes = entries[ARCHIVE_MANIFEST];
  const signature = entries[ARCHIVE_SIGNATURE];
  if (!manifestBytes || !signature) {
    throw new ArchiveInvalid('The archive has no signed manifest.');
  }
  const publicKey = createPublicKey(publicKeyPem);
  const valid = verify(
    null,
    manifestBytes,
    publicKey,
    Buffer.from(Buffer.from(signature).toString('utf8'), 'base64'),
  );
  if (!valid) throw new ArchiveInvalid('The manifest’s signature does not match this key.');
  let manifest: ArchiveManifest;
  try {
    manifest = ArchiveManifest.parse(JSON.parse(Buffer.from(manifestBytes).toString('utf8')));
  } catch {
    throw new ArchiveInvalid('The manifest is not one this version reads.');
  }
  const listed = [
    ...manifest.tables.map((table) => ({
      path: table.path,
      bytes: table.bytes,
      sha256: table.sha256,
    })),
    ...manifest.media.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
  ];
  for (const entry of listed) {
    const bytes = entries[entry.path];
    if (!bytes) throw new ArchiveInvalid(`${entry.path} is missing.`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== entry.bytes || sha256 !== entry.sha256) {
      throw new ArchiveInvalid(`${entry.path} was changed.`);
    }
  }
  const expected = new Set([ARCHIVE_MANIFEST, ARCHIVE_SIGNATURE, ...listed.map((e) => e.path)]);
  const extra = Object.keys(entries).filter((path) => !expected.has(path) && !path.endsWith('/'));
  if (extra.length > 0) throw new ArchiveInvalid(`${extra[0]} is not in the manifest.`);
  return { manifest, entries };
}
