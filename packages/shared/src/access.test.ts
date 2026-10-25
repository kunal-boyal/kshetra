import { describe, expect, it } from 'vitest';
import {
  canGrant,
  DATA_SCOPES,
  PERMISSIONS_BY_AREA,
  PLATFORM_PERMISSIONS,
  scopeContains,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
} from './access';

describe('the permission catalogue (spec Appendix E)', () => {
  it('lists every tenant permission once, as <area>.<action>', () => {
    expect(TENANT_PERMISSIONS).toHaveLength(66);
    expect(new Set(TENANT_PERMISSIONS).size).toBe(TENANT_PERMISSIONS.length);
    for (const permission of TENANT_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('keeps vendor permissions out of tenant roles', () => {
    for (const permission of PLATFORM_PERMISSIONS) {
      expect(permission.startsWith('platform.')).toBe(true);
      expect(TENANT_PERMISSIONS).not.toContain(permission);
    }
  });

  it('groups permissions by the areas of the catalogue', () => {
    expect(Object.keys(PERMISSIONS_BY_AREA)).toHaveLength(13);
    expect(PERMISSIONS_BY_AREA.integrations_and_billing).toContain('billing.manage');
  });

  it('names the six roles every tenant starts with (spec 4.2)', () => {
    expect(SYSTEM_ROLES).toEqual([
      'tenant_admin',
      'business_head',
      'manager',
      'field_user',
      'back_office',
      'viewer',
    ]);
  });
});

describe('scopes', () => {
  it('each reach the user, and the wider ones reach the narrower', () => {
    for (const scope of DATA_SCOPES) {
      expect(scopeContains(scope, 'self')).toBe(true);
      expect(scopeContains('tenant', scope)).toBe(true);
    }
    expect(scopeContains('team_or_territory', 'team')).toBe(true);
    expect(scopeContains('team_or_territory', 'territory')).toBe(true);
    expect(scopeContains('team', 'territory')).toBe(false);
    expect(scopeContains('territory', 'team')).toBe(false);
    expect(scopeContains('team', 'tenant')).toBe(false);
    expect(scopeContains('self', 'team')).toBe(false);
  });
});

describe('granting a role', () => {
  const admin = { permissions: TENANT_PERMISSIONS, scope: 'tenant' as const };
  const head = {
    permissions: TENANT_PERMISSIONS.filter((p) => p !== 'billing.manage'),
    scope: 'tenant' as const,
  };
  const manager = { permissions: ['user.view', 'user.reset_device'], scope: 'team' as const };

  it('lets an admin grant anything', () => {
    expect(canGrant(admin, admin)).toBe(true);
    expect(canGrant(admin, manager)).toBe(true);
  });

  it('refuses a permission the granter lacks', () => {
    expect(canGrant(head, admin)).toBe(false);
    expect(canGrant(head, head)).toBe(true);
    expect(canGrant(manager, { permissions: ['user.manage'], scope: 'self' })).toBe(false);
  });

  it('refuses a scope wider than the granter reaches', () => {
    expect(canGrant(manager, { permissions: ['user.view'], scope: 'team' })).toBe(true);
    expect(canGrant(manager, { permissions: ['user.view'], scope: 'self' })).toBe(true);
    expect(canGrant(manager, { permissions: ['user.view'], scope: 'tenant' })).toBe(false);
    expect(canGrant(manager, { permissions: ['user.view'], scope: 'territory' })).toBe(false);

    // A permission of a module that is off does nothing, so it never stops a grant (D82, D89).
    const payroll = { permissions: ['user.view', 'payslip.view'], scope: 'self' as const };
    expect(canGrant(manager, payroll)).toBe(false);
    expect(canGrant({ ...manager, modulesOff: ['payroll_inputs'] }, payroll)).toBe(true);
  });

  it('lets an API client give any role but one that can change access (D94)', () => {
    const client = {
      permissions: ['user.view', 'user.manage'],
      scope: 'tenant' as const,
      apiClient: {},
    };
    const field = {
      permissions: ['shift.use', 'visit.use', 'submission.create'],
      scope: 'self' as const,
    };
    expect(canGrant(client, field)).toBe(true);
    expect(canGrant(client, manager)).toBe(true);
    expect(canGrant(client, admin)).toBe(false);
    expect(canGrant(client, { permissions: ['settings.manage'], scope: 'self' })).toBe(false);
  });
});
