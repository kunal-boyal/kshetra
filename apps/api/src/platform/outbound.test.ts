import { describe, expect, it } from 'vitest';
import { isReserved, publicFetch, publicLookup, publicUrlIssue } from './outbound';

describe('outbound calls to addresses tenants name (decision D101)', () => {
  it('knows every special-purpose range, however an address is written', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '198.18.0.1',
      '192.0.0.8',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      // IPv4-mapped loopback, as URL parsing normalises it: the old check stripped `::ffff:`
      // as text and let this through.
      '::ffff:7f00:1',
      '::ffff:127.0.0.1',
      '64:ff9b::a00:1',
      '2002:7f00:1::',
      'fd00::1',
      'fe80::1',
      'not an address',
    ]) {
      expect(isReserved(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '203.0.114.1', '2606:4700:4700::1111']) {
      expect(isReserved(address), address).toBe(false);
    }
  });

  it('takes only https on 443, without credentials, to a public address', async () => {
    expect(await publicUrlIssue('http://erp.example.com/hooks')).toBe('Use an https:// address');
    expect(await publicUrlIssue('https://user:pw@erp.example.com/')).toMatch(/user name/);
    expect(await publicUrlIssue('https://erp.example.com:8443/')).toMatch(/standard HTTPS port/);
    expect(await publicUrlIssue('https://[::ffff:7f00:1]/hooks')).toMatch(/public address/);
    expect(await publicUrlIssue('https://169.254.169.254/latest/meta-data')).toMatch(
      /public address/,
    );
    expect(await publicUrlIssue('https://localhost/')).toMatch(/public address/);
    expect(await publicUrlIssue('https://8.8.8.8/')).toBeNull();
  });

  it('refuses to connect a socket to a name that resolves privately', async () => {
    const error = await new Promise<Error | null>((resolve) =>
      publicLookup('localhost', {}, (failure) => resolve(failure)),
    );
    expect(error?.message).toMatch(/public address/);
  });

  it('never fetches a private address, so it can’t reach the cell’s own network', async () => {
    await expect(publicFetch('https://127.0.0.1/')).rejects.toThrow(/public address/);
    await expect(publicFetch('https://[::ffff:a00:1]/')).rejects.toThrow(/public address/);
  });
});
