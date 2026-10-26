import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientAddress, trustHops, VIEWER_ADDRESS_HEADER } from './client-address';

const SECRET = 'a-long-origin-secret-from-terraform';

/** A server behind one load balancer, answering with the address it takes for the caller. */
function behindBalancer() {
  const app = Fastify({ trustProxy: trustHops(1) });
  app.get('/', async (request) => ({ caller: clientAddress(request, SECRET) }));
  return app;
}

describe('the caller’s address (decision D101)', () => {
  it('believes only the load balancer, never what a phone wrote before it', async () => {
    const app = behindBalancer();
    const reply = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '10.0.1.20',
      // The phone claimed 1.1.1.1; the balancer appended the address it really came from.
      headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' },
    });
    expect(reply.json()).toEqual({ caller: '203.0.113.9' });
  });

  it('takes the viewer CloudFront saw, but only with CloudFront’s secret', async () => {
    const app = behindBalancer();
    const through = (headers: Record<string, string>) =>
      app
        .inject({
          method: 'GET',
          url: '/',
          remoteAddress: '10.0.1.20',
          headers: { 'x-forwarded-for': '198.51.100.7, 130.176.0.1', ...headers },
        })
        .then((reply) => reply.json().caller);
    expect(
      await through({ 'x-origin-verify': SECRET, [VIEWER_ADDRESS_HEADER]: '198.51.100.7' }),
    ).toBe('198.51.100.7');
    // Without the secret, or with a wrong one, the header is the caller's own claim.
    expect(await through({ [VIEWER_ADDRESS_HEADER]: '9.9.9.9' })).toBe('130.176.0.1');
    expect(
      await through({ 'x-origin-verify': 'not-the-secret', [VIEWER_ADDRESS_HEADER]: '9.9.9.9' }),
    ).toBe('130.176.0.1');
    // Nor is anything but an address taken.
    expect(await through({ 'x-origin-verify': SECRET, [VIEWER_ADDRESS_HEADER]: 'localhost' })).toBe(
      '130.176.0.1',
    );
  });
});
