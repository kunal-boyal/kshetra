import { describe, expect, it } from 'vitest';
import {
  supportApprovalIssue,
  supportPermissions,
  supportRequestIssue,
  supportStatus,
} from './support';

const at = (time: string) => new Date(`2026-10-26T${time}:00Z`);
const asked = {
  createdAt: at('04:00'),
  startsAt: null,
  endsAt: null,
  declinedAt: null,
  revokedAt: null,
};

describe('support grants (M22, decision D93)', () => {
  it('waits for a decision for a day, then lapses', () => {
    expect(supportStatus(asked, at('05:00'))).toBe('requested');
    expect(supportStatus(asked, new Date('2026-10-27T04:00:00Z'))).toBe('lapsed');
    expect(supportStatus({ ...asked, declinedAt: at('04:10') }, at('05:00'))).toBe('declined');
    expect(supportStatus({ ...asked, revokedAt: at('04:10') }, at('05:00'))).toBe('ended');
  });

  it('is active from its start to its end, unless ended first', () => {
    const approved = { ...asked, startsAt: at('04:30'), endsAt: at('08:30') };
    expect(supportStatus(approved, at('06:00'))).toBe('active');
    expect(supportStatus(approved, at('08:30'))).toBe('expired');
    expect(supportStatus({ ...approved, revokedAt: at('05:00') }, at('06:00'))).toBe('ended');
    // Ending one already over changes nothing.
    expect(supportStatus({ ...approved, revokedAt: at('09:00') }, at('10:00'))).toBe('expired');
  });

  it('takes requests of 1 to 8 hours, and emergency ones that read for at most 2', () => {
    expect(supportRequestIssue({ scope: 'write', hours: 8, emergency: false })).toBeNull();
    expect(supportRequestIssue({ scope: 'read', hours: 9, emergency: false })?.path).toBe('hours');
    expect(supportRequestIssue({ scope: 'read', hours: 2, emergency: true })).toBeNull();
    expect(supportRequestIssue({ scope: 'read', hours: 3, emergency: true })?.path).toBe('hours');
    expect(supportRequestIssue({ scope: 'write', hours: 1, emergency: true })?.path).toBe('scope');
  });

  it('lets an admin narrow and shorten a request, never widen or lengthen it', () => {
    const write = { scope: 'write' as const, hours: 4 };
    expect(supportApprovalIssue(write, { scope: 'read', hours: 2 })).toBeNull();
    expect(supportApprovalIssue(write, { scope: 'write', hours: 5 })?.path).toBe('hours');
    expect(supportApprovalIssue({ scope: 'read', hours: 4 }, write)?.path).toBe('scope');
  });

  it('never lets support pay the bills', () => {
    const permissions = supportPermissions();
    expect(permissions).toContain('settings.manage');
    expect(permissions).toContain('audit.view');
    expect(permissions).not.toContain('billing.manage');
  });
});
