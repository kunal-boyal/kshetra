import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS_BY_AREA,
  PLATFORM_PERMISSIONS,
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
