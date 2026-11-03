import { describe, expect, it } from 'vitest';
import { keepWhileSame } from './query-keep';

describe('keeping a list on screen while another of its own loads', () => {
  const rows = ['last month'];

  it('keeps it while only the parts that may change differ', () => {
    const keep = keepWhileSame(['plan', 'asha', '2026-11'], [2]);
    expect(keep(rows, { queryKey: ['plan', 'asha', '2026-10'] })).toBe(rows);
  });

  it('drops it for someone or something else, and with nothing before', () => {
    const keep = keepWhileSame(['plan', 'ravi', '2026-11'], [2]);
    expect(keep(rows, { queryKey: ['plan', 'asha', '2026-10'] })).toBeUndefined();
    expect(keep(rows, undefined)).toBeUndefined();
    // Objects compare by what they hold.
    const report = keepWhileSame(['report', 'visits', { userId: 'b' }], [2]);
    expect(report(rows, { queryKey: ['report', 'orders', { userId: 'b' }] })).toBeUndefined();
    expect(report(rows, { queryKey: ['report', 'visits', { userId: 'a' }] })).toBe(rows);
  });
});
