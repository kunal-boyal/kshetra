import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Config } from '../config';
import { ResponseContract } from './response-contract';

const Person = z.object({ id: z.string(), name: z.string() });

/** A handler with `Person` as its answer's schema, answering `body` with `status`. */
async function answer(body: unknown, status = 200, env = 'test') {
  const reflector = {
    get: () => ({ summary: 'x', tag: 'x', response: Person }),
  } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', routeOptions: { url: '/v1/people/:id' } }),
      getResponse: () => ({ statusCode: status }),
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(body) };
  const interceptor = new ResponseContract(reflector, { NODE_ENV: env } as Config);
  return firstValueFrom(interceptor.intercept(context, next));
}

describe('answers pass through their declared schema (ASVS V8.2.3, D101)', () => {
  it('drops what the schema doesn’t name', async () => {
    await expect(
      answer({ id: 'p1', name: 'Asha', passwordHash: 'scrypt$…', tenantId: 't1' }),
    ).resolves.toEqual({ id: 'p1', name: 'Asha' });
  });

  it('fails loudly outside production when an answer doesn’t fit, and sends it as it was there', async () => {
    await expect(answer({ id: 'p1' })).rejects.toThrow(
      'GET /v1/people/:id answered outside its contract: name:',
    );
    await expect(answer({ id: 'p1' }, 200, 'production')).resolves.toEqual({ id: 'p1' });
  });

  it('leaves errors a route answers itself alone', async () => {
    await expect(answer({ error: 'invalid_client' }, 401)).resolves.toEqual({
      error: 'invalid_client',
    });
  });
});
