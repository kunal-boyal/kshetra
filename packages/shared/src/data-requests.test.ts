import { describe, expect, it } from 'vitest';
import {
  dataRequestCloseIssue,
  dataRequestDueOn,
  dataRequestRaiseIssue,
  dataRequestReminderDue,
} from './data-requests';

describe('personal data requests (decision D95)', () => {
  it('are due 30 days on, with a reminder 7 days before', () => {
    expect(dataRequestDueOn('2026-10-26')).toBe('2026-11-25');
    expect(dataRequestReminderDue('2026-11-25', '2026-11-17')).toBe(false);
    expect(dataRequestReminderDue('2026-11-25', '2026-11-18')).toBe(true);
    expect(dataRequestReminderDue('2026-11-25', '2026-12-01')).toBe(true);
  });

  it('allow one open request of each kind', () => {
    expect(dataRequestRaiseIssue('access', ['correction'])).toBeNull();
    expect(dataRequestRaiseIssue('access', ['access'])).toMatch(/exists already/);
  });

  it('close only as the kind allows', () => {
    const base = {
      kind: 'access' as const,
      status: 'received' as const,
      outcome: 'completed' as const,
      response: '',
      archiveReady: true,
      personActive: true,
    };
    expect(dataRequestCloseIssue(base)).toBeNull();
    expect(dataRequestCloseIssue({ ...base, archiveReady: false })?.issue).toMatch(/archive/);
    expect(dataRequestCloseIssue({ ...base, kind: 'erasure' })?.issue).toMatch(/Deactivate/);
    expect(dataRequestCloseIssue({ ...base, kind: 'erasure', personActive: false })).toBeNull();
    expect(dataRequestCloseIssue({ ...base, outcome: 'refused' })?.path).toBe('response');
    expect(dataRequestCloseIssue({ ...base, status: 'completed' })?.issue).toMatch(/closed/);
  });
});
