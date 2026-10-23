import { describe, expect, it } from 'vitest';
import { nextStep, type ResolvedStep, routeRequest } from './workflow';

const ASHA = 'asha';
const MANAGER = 'manager';
const HEAD = 'head';
const ADMIN = 'admin';

const step = (approvers: string[], extra: Partial<ResolvedStep> = {}): ResolvedStep => ({
  applies: true,
  approvers,
  ...extra,
});

describe('routing a request through its chain (BR-31)', () => {
  it('FX-23: skips the manager step when the manager is the business head', () => {
    const routed = routeRequest([step([HEAD]), step([HEAD])], ASHA, [ADMIN])!;
    expect(routed.map((entry) => [entry.status, entry.skipReason])).toEqual([
      ['skipped', 'repeated'],
      ['pending', null],
    ]);
    expect(routed.filter((entry) => entry.status === 'pending')).toHaveLength(1);
    expect(routed[1]!.approvers).toEqual([HEAD]);
  });

  it('waits at the first step and holds the rest back', () => {
    const routed = routeRequest([step([MANAGER]), step([HEAD])], ASHA, [ADMIN])!;
    expect(routed.map((entry) => entry.status)).toEqual(['pending', 'waiting']);
    expect(nextStep(routed, 0)).toBe(1);
    expect(nextStep(routed, 1)).toBeNull();
  });

  it('skips a step whose condition does not hold', () => {
    const routed = routeRequest([step([MANAGER]), step([HEAD], { applies: false })], ASHA, [
      ADMIN,
    ])!;
    expect(routed[1]).toMatchObject({ status: 'skipped', skipReason: 'condition' });
    expect(nextStep(routed, 0)).toBeNull();
  });

  it('skips a step with nobody to decide, or escalates it when it says so', () => {
    expect(routeRequest([step([]), step([HEAD])], ASHA, [ADMIN])!.map((s) => s.skipReason)).toEqual(
      ['no_approver', null],
    );
    const escalated = routeRequest([step([], { escalateTo: [ADMIN] }), step([HEAD])], ASHA, [])!;
    expect(escalated[0]).toMatchObject({ status: 'pending', approvers: [ADMIN], escalated: true });
  });

  it('never lets the requester decide: their step is skipped, or they are left off it', () => {
    const own = routeRequest([step([ASHA]), step([HEAD])], ASHA, [ADMIN])!;
    expect(own[0]).toMatchObject({ status: 'skipped', skipReason: 'requester' });
    const shared = routeRequest([step([ASHA, MANAGER])], ASHA, [ADMIN])!;
    expect(shared[0]!.approvers).toEqual([MANAGER]);
  });

  it('goes to the fallback approvers when no step remains, and to nobody when none of them can', () => {
    const routed = routeRequest([step([])], ASHA, [ADMIN, ASHA])!;
    expect(routed).toHaveLength(2);
    expect(routed[1]).toMatchObject({ status: 'pending', approvers: [ADMIN], fallback: true });
    expect(routeRequest([step([])], ASHA, [ASHA])).toBeNull();
  });

  it('skips only consecutive repeats, so the same person may decide twice with someone between', () => {
    const routed = routeRequest([step([MANAGER]), step([HEAD]), step([MANAGER])], ASHA, [ADMIN])!;
    expect(routed.map((entry) => entry.status)).toEqual(['pending', 'waiting', 'waiting']);
  });

  it('counts repeats across skipped steps, as the chain the requester actually meets', () => {
    const routed = routeRequest(
      [step([HEAD]), step([MANAGER], { applies: false }), step([HEAD])],
      ASHA,
      [ADMIN],
    )!;
    expect(routed.map((entry) => entry.skipReason)).toEqual(['repeated', 'condition', null]);
  });
});
