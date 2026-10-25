import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { MODULE_KEYS } from '@thelamp/shared';
import { z } from 'zod';
import { canonicalJson } from './canonical-json';

/**
 * What a licence states (spec M23, decision D90): the tenant a dedicated install serves, its user
 * cap, its modules and its expiry. The vendor signs it with its Ed25519 private key, which never
 * leaves the vendor; the install checks it offline with the public key it is given.
 */
export const LicenceTerms = z.strictObject({
  licenceId: z.uuid(),
  tenantId: z.uuid(),
  tenantSlug: z.string().min(1),
  /** People who may be active at once. */
  users: z.int().min(1),
  modules: z
    .array(z.enum(MODULE_KEYS))
    .refine((modules) => modules.includes('core'), 'Every licence includes core'),
  issuedOn: z.iso.date(),
  /** The last day it is valid; 30 days of grace follow (BR-49). */
  expiresOn: z.iso.date(),
});
export type LicenceTerms = z.infer<typeof LicenceTerms>;

const LicenceFile = z.strictObject({
  terms: LicenceTerms,
  /** Ed25519 over the terms' canonical JSON, in base64. */
  signature: z.string().min(1),
});

export class LicenceInvalid extends Error {}

/** A new key pair, as PEM: the private key stays with the vendor; installs get the public one. */
export function licenceKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** The licence file for some terms, signed with the vendor's private key. */
export function signLicence(terms: LicenceTerms, privateKeyPem: string): string {
  const checked = LicenceTerms.parse(terms);
  const signature = sign(
    null,
    Buffer.from(canonicalJson(checked)),
    createPrivateKey(privateKeyPem),
  ).toString('base64');
  return `${JSON.stringify({ terms: checked, signature }, null, 2)}\n`;
}

/**
 * The terms of a licence file, once its signature checks out against the vendor's public key.
 * Anything else, such as a changed cap or another key's signature, throws `LicenceInvalid`.
 */
export function readLicence(text: string, publicKeyPem: string): LicenceTerms {
  let file: z.infer<typeof LicenceFile>;
  try {
    file = LicenceFile.parse(JSON.parse(text));
  } catch {
    throw new LicenceInvalid('The licence file is not one the vendor issued.');
  }
  const valid = verify(
    null,
    Buffer.from(canonicalJson(file.terms)),
    createPublicKey(publicKeyPem),
    Buffer.from(file.signature, 'base64'),
  );
  if (!valid) throw new LicenceInvalid('The licence file’s signature does not match its terms.');
  return file.terms;
}
