import { describe, expect, it } from 'vitest';
import { closedByModules, effectivePermissions, moduleOf, permissionClosed } from './modules';

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

  it('keep a shared permission while any of its modules is open (D128)', () => {
    // Payslips are the estimate's or the statutory payroll's, whichever is on.
    expect(permissionClosed('payslip.view', ['payroll_inputs'])).toBe(false);
    expect(permissionClosed('payslip.view', ['payroll_inputs', 'statutory_payroll'])).toBe(true);
    expect(permissionClosed('payroll.manage', ['payroll_inputs'])).toBe(true);
    expect([
      ...effectivePermissions(['payslip.view', 'payroll.manage'], ['payroll_inputs']),
    ]).toEqual(['payslip.view']);
    expect(closedByModules(['payslip.view'], ['payroll_inputs'])).toBe(false);
    expect(closedByModules(['payslip.view'], ['payroll_inputs', 'statutory_payroll'])).toBe(true);
  });
});
