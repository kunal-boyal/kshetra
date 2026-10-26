import { describe, expect, it } from 'vitest';
import { LicenceEntitlements } from '../modules/billing/licence-entitlements';
import { LicenceInvalid, licenceKeys, readLicence, signLicence } from './licence';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TERMS = {
  licenceId: '01a10000-0000-7000-8000-0000000000f1',
  tenantId: '01a10000-0000-7000-8000-0000000000b1',
  tenantSlug: 'sunrise-agro',
  users: 40,
  modules: ['core' as const, 'orders' as const],
  issuedOn: '2026-10-25',
  expiresOn: '2027-03-31',
};

describe('licences (spec M23, BR-49)', () => {
  const vendor = licenceKeys();

  it('reads a licence signed with the vendor’s key', () => {
    const file = signLicence(TERMS, vendor.privateKey);
    expect(readLicence(file, vendor.publicKey)).toEqual(TERMS);
  });

  it('refuses a changed licence, another key’s, and anything else', () => {
    const file = signLicence(TERMS, vendor.privateKey);
    const raised = file.replace('"users": 40', '"users": 400');
    expect(() => readLicence(raised, vendor.publicKey)).toThrow(LicenceInvalid);
    const forged = signLicence(TERMS, licenceKeys().privateKey);
    expect(() => readLicence(forged, vendor.publicKey)).toThrow(
      'The licence file’s signature does not match its terms.',
    );
    expect(() => readLicence('not a licence', vendor.publicKey)).toThrow(LicenceInvalid);
    expect(() => signLicence({ ...TERMS, modules: ['orders'] }, vendor.privateKey)).toThrow();
  });

  it('gives the licence’s modules and cap, and only reads once it has expired past grace', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'licence-'));
    const path = join(folder, 'tenant.licence');
    writeFileSync(path, signLicence(TERMS, vendor.privateKey));
    const licensed = new LicenceEntitlements(path, vendor.publicKey);
    expect(await licensed.forTenant(TERMS.tenantId, new Date('2027-04-15T06:00:00Z'))).toEqual({
      modules: ['core', 'orders'],
      limits: {
        users: 40,
        storageGb: null,
        apiPerMinute: null,
        requestsPerMinute: null,
        queueSlots: null,
        importRows: null,
        exportRows: null,
      },
      readOnly: false,
    });
    expect(
      (await licensed.forTenant(TERMS.tenantId, new Date('2027-05-01T06:00:00Z'))).readOnly,
    ).toBe(true);
    // Another tenant on the install has no licence.
    expect(
      await licensed.forTenant('01a10000-0000-7000-8000-0000000000b2', new Date('2026-11-01')),
    ).toMatchObject({ modules: ['core'], readOnly: true });
    writeFileSync(path, signLicence(TERMS, licenceKeys().privateKey));
    expect(() => new LicenceEntitlements(path, vendor.publicKey)).toThrow(LicenceInvalid);
  });
});
