import { describe, expect, it } from 'vitest';
import { AppError, ERROR_HTTP_STATUS, isErrorCode } from './errors';

describe('error codes', () => {
  it('map to the HTTP statuses of spec 11.4', () => {
    expect(ERROR_HTTP_STATUS.VALIDATION).toBe(400);
    expect(ERROR_HTTP_STATUS.SESSION_REVOKED).toBe(401);
    expect(ERROR_HTTP_STATUS.OUT_OF_SCOPE).toBe(403);
    expect(ERROR_HTTP_STATUS.IDEMPOTENCY_CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.SEAT_LIMIT).toBe(402);
    expect(ERROR_HTTP_STATUS.SYNC_RESET).toBe(410);
    expect(ERROR_HTTP_STATUS.TENANT_SUSPENDED).toBe(423);
    expect(ERROR_HTTP_STATUS.UPGRADE_REQUIRED).toBe(426);
    expect(ERROR_HTTP_STATUS.RATE_LIMITED).toBe(429);
  });

  it('only use client-error or server-error statuses', () => {
    for (const status of Object.values(ERROR_HTTP_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('recognise known codes only', () => {
    expect(isErrorCode('PRICE_CHANGED')).toBe(true);
    expect(isErrorCode('price_changed')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
  });
});

describe('AppError', () => {
  it('carries its code, status and details', () => {
    const error = new AppError('VALIDATION', 'Check the highlighted fields.', [
      { path: 'items[0].price', issue: 'Must be a decimal' },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('VALIDATION');
    expect(error.status).toBe(400);
    expect(error.details).toEqual([{ path: 'items[0].price', issue: 'Must be a decimal' }]);
  });
});
