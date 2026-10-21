import { describe, expect, it } from 'vitest';
import { closedByModules, effectivePermissions, moduleOf } from './modules';

describe('modules (spec 5.13, M2)', () => {
  it('place each permission in its module, and the rest in Core', () => {
    expect(moduleOf('order.create')).toBe('orders');
    expect(moduleOf('leave.request')).toBe('leave_attendance');
    expect(moduleOf('catalogue.manage')).toBe('core');
    expect(moduleOf('report.view')).toBe('core');
  });

  it('take a switched-off module’s permissions from a role', () => {
    const effective = effectivePermissions(
      ['report.view', 'order.view', 'leave.request'],
      ['orders'],
    );
    expect([...effective].sort()).toEqual(['leave.request', 'report.view']);
  });

  it('close a route only when everything it needs is in modules that are off', () => {
    expect(closedByModules(['order.decide'], ['orders'])).toBe(true);
    expect(closedByModules(['order.view', 'report.view'], ['orders'])).toBe(false);
    expect(closedByModules(['order.view'], [])).toBe(false);
    expect(closedByModules([], ['orders'])).toBe(false);
  });
});
