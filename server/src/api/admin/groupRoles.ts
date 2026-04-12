export const ADMIN_GROUP_ROLE_VALUES = ['member', 'admin'] as const;

export type AdminGroupRole = (typeof ADMIN_GROUP_ROLE_VALUES)[number];

const adminGroupRoles = new Set<string>(ADMIN_GROUP_ROLE_VALUES);

export function isAdminGroupRole(role: unknown): role is AdminGroupRole {
  return typeof role === 'string' && adminGroupRoles.has(role);
}
