import { NotFoundException } from '@nestjs/common';
import { AppError } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toErrorResponse } from './errors';

describe('toErrorResponse', () => {
  it('sends Retry-After with a rate-limit error', () => {
    const error = new AppError('RATE_LIMITED', 'Too many attempts.', undefined, {
      retryAfterSeconds: 42,
    });
    const response = toErrorResponse(error, 'req-9');
    expect(response.status).toBe(429);
    expect(response.headers).toEqual({ 'retry-after': '42' });
  });

  it('keeps an AppError code, message and details', () => {
    const error = new AppError('PRICE_CHANGED', 'The price changed.', [
      { path: 'lines[0].price', issue: 'Was 120.00' },
    ]);
    expect(toErrorResponse(error, 'req-1')).toEqual({
      status: 409,
      body: {
        error: {
          code: 'PRICE_CHANGED',
          message: 'The price changed.',
          details: [{ path: 'lines[0].price', issue: 'Was 120.00' }],
          requestId: 'req-1',
        },
      },
    });
  });

  it('turns validation failures into VALIDATION with field paths', () => {
    const schema = z.object({ lines: z.array(z.object({ qty: z.number().positive() })) });
    const result = schema.safeParse({ lines: [{ qty: 1 }, { qty: -2 }] });
    const { status, body } = toErrorResponse(result.error, 'req-2');
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details?.[0]?.path).toBe('lines[1].qty');
  });

  it('maps framework exceptions by status', () => {
    expect(toErrorResponse(new NotFoundException(), 'req-3').body.error.code).toBe('NOT_FOUND');
    expect(
      toErrorResponse({ statusCode: 415, message: 'Unsupported Media Type' }, 'req-4'),
    ).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION' } },
    });
  });

  it('never leaks the details of an unexpected failure', () => {
    const { status, body } = toErrorResponse(new Error('connection to 10.0.3.7 refused'), 'req-5');
    expect(status).toBe(500);
    expect(body.error).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong. Try again in a moment.',
      requestId: 'req-5',
    });
  });
});
