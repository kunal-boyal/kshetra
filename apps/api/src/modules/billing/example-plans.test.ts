import { AVAILABLE_MODULES, PlanBody } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PLANS } from './example-plans';

describe('the example plans (decision D89)', () => {
  it('are valid plans, and the largest includes every module built', () => {
    for (const plan of EXAMPLE_PLANS) expect(PlanBody.safeParse(plan).success).toBe(true);
    const enterprise = EXAMPLE_PLANS.find((plan) => plan.key === 'enterprise')!;
    expect([...enterprise.modules].sort()).toEqual([...AVAILABLE_MODULES].sort());
  });
});
