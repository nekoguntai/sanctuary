import { describe, expect, it } from 'vitest';
import {
  ADMIN_GROUP_ROLE_VALUES,
  isAdminGroupRole,
} from '../../../src/api/admin/groupRoles';

describe('Admin group roles', () => {
  it('exports the supported group role values', () => {
    expect(ADMIN_GROUP_ROLE_VALUES).toEqual(['member', 'admin']);
  });

  it('accepts supported group roles', () => {
    expect(isAdminGroupRole('member')).toBe(true);
    expect(isAdminGroupRole('admin')).toBe(true);
  });

  it('rejects unsupported role values', () => {
    expect(isAdminGroupRole('owner')).toBe(false);
    expect(isAdminGroupRole('')).toBe(false);
    expect(isAdminGroupRole(null)).toBe(false);
    expect(isAdminGroupRole(undefined)).toBe(false);
    expect(isAdminGroupRole(123)).toBe(false);
  });
});
