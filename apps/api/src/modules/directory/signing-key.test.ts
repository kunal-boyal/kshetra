import { generateKeyPairSync } from 'node:crypto';
import { newId } from '@kshetra/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { AccessTokens } from '../../platform/auth';
import { ACCESS_TOKEN_SECONDS, SigningKey } from './signing-key';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://cell_app:x@localhost:5433/kshetra',
  DIRECTORY_DATABASE_URL: 'postgres://directory_app:x@localhost:5433/kshetra',
  REDIS_URL: 'redis://localhost:6380',
  OTP_PEPPER: 'a-test-pepper-of-16+',
};

async function keyFor(env: Record<string, string> = {}) {
  const config = loadConfig({ ...base, ...env });
  const key = new SigningKey(config);
  await key.onModuleInit();
  return { key, verifier: new AccessTokens(key, config) };
}

const claims = () => ({ userId: newId(), tenantId: newId(), cell: 'local', revision: 3 });

describe('access tokens', () => {
  it('carry the user, tenant, cell and auth revision for 15 minutes', async () => {
    const { key, verifier } = await keyFor();
    const input = claims();
    const now = new Date();
    const { token, expiresAt } = await key.sign(input, now);
    expect(expiresAt.getTime() - Math.floor(now.getTime() / 1000) * 1000).toBe(
      ACCESS_TOKEN_SECONDS * 1000,
    );
    await expect(verifier.verify(token)).resolves.toMatchObject({
      sub: input.userId,
      tid: input.tenantId,
      cell: 'local',
      rev: 3,
    });
  });

  it('say an expired token is expired, so the app refreshes it', async () => {
    const { key, verifier } = await keyFor();
    const { token } = await key.sign(claims(), new Date(Date.now() - 16 * 60_000));
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('refuse tokens for another product, from another key or tampered with', async () => {
    const { key, verifier } = await keyFor();
    const other = await keyFor({ PRODUCT_SLUG: 'otherproduct' });
    const stranger = await keyFor();

    const { token } = await other.key.sign(claims());
    await expect(other.verifier.verify(token)).resolves.toBeTruthy();
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const { token: foreign } = await stranger.key.sign(claims());
    await expect(verifier.verify(foreign)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const { token: mine } = await key.sign(claims());
    const [header, payload, signature] = mine.split('.');
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    forged.rev = 99;
    const tampered = [header, Buffer.from(JSON.stringify(forged)).toString('base64url'), signature];
    await expect(verifier.verify(tampered.join('.'))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(verifier.verify('not-a-token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('publish only the public half of the key, with a stable key ID', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const escaped = pem.replace(/\n/g, '\\n');
    const one = await keyFor({ JWT_SIGNING_KEY: escaped });
    const two = await keyFor({ JWT_SIGNING_KEY: escaped });

    const { keys } = await one.key.jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(keys[0]).not.toHaveProperty('d');
    expect((await two.key.jwks()).keys[0]!.kid).toBe(keys[0]!.kid);

    const { token } = await one.key.sign(claims());
    await expect(two.verifier.verify(token)).resolves.toBeTruthy();
  });
});
