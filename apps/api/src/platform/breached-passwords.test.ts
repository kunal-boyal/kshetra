import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwnedPasswords } from './breached-passwords';
import { publicFetch } from './outbound';

vi.mock('./outbound', () => ({ publicFetch: vi.fn() }));
const fetch = vi.mocked(publicFetch);

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').toUpperCase();

describe('Have I Been Pwned’s range API (decision D101)', () => {
  beforeEach(() => fetch.mockReset());

  it('sends only five hex digits, asks for padding, and finds the rest in the answer', async () => {
    const hash = sha1('correct horse battery staple');
    fetch.mockResolvedValue(
      new Response(`0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n${hash.slice(5)}:3861\r\n`),
    );
    expect(await new PwnedPasswords('The Lamp').seen('correct horse battery staple')).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(init?.headers).toMatchObject({ 'add-padding': 'true', 'user-agent': 'The Lamp' });
  });

  it('takes a padding line, counted zero, as not seen', async () => {
    const hash = sha1('a quiet orange tractor');
    fetch.mockResolvedValue(new Response(`${hash.slice(5)}:0\n`));
    expect(await new PwnedPasswords('The Lamp').seen('a quiet orange tractor')).toBe(false);
  });

  it('lets the password through when the service fails or can’t be reached', async () => {
    fetch.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    expect(await new PwnedPasswords('The Lamp').seen('anything')).toBe(false);
    fetch.mockRejectedValueOnce(new Error('timed out'));
    expect(await new PwnedPasswords('The Lamp').seen('anything')).toBe(false);
  });
});
