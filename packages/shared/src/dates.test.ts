import { describe, expect, it } from 'vitest';
import { todayIn } from './dates';

describe('todayIn', () => {
  it("gives the date on the tenant's own calendar", () => {
    const lateEvening = new Date('2026-10-05T20:00:00Z');
    expect(todayIn('Asia/Kolkata', lateEvening)).toBe('2026-10-06');
    expect(todayIn('UTC', lateEvening)).toBe('2026-10-05');
    expect(todayIn('America/New_York', lateEvening)).toBe('2026-10-05');
  });
});
