import { describe, expect, it } from 'vitest';
import { CallMeter, ErpDailyLimit } from './erp-calls';

describe('the call meter (BR-59)', () => {
  it('stops before the day’s limit, keeping a tenth back', async () => {
    const meter = new CallMeter(898, 1000, async () => {});
    await meter.take();
    await meter.take();
    await expect(meter.take()).rejects.toBeInstanceOf(ErpDailyLimit);
    expect(meter.used).toBe(900);
    expect(meter.calls).toBe(2);
  });

  it('waits once 90 calls fall within a minute', async () => {
    const waits: number[] = [];
    const meter = new CallMeter(0, 100_000, async (ms) => {
      waits.push(ms);
    });
    for (let call = 0; call < 90; call += 1) await meter.take();
    expect(waits).toEqual([]);
    await meter.take();
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(59_000);
    expect(waits[0]).toBeLessThanOrEqual(60_000);
  });
});
