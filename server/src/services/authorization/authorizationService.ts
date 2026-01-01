/**
 * Authorization Service
 *
 * Centralized policy-based access control for all resources.
 * Provides a unified interface for checking permissions across
 * wallets, devices, and other resources.
 *
 * ## Features
 *
 * - Policy-based access control
 * - Role hierarchy support
 * - Cacheable permission checks
 * - Audit trail integration
 *
 * ## Usage
 *
 * ```typescript
 * const authz = authorizationService;
 *
 * // Check permission
 * const canEdit = await authz.can(userId, 'edit', 'wallet', walletId);
 *
 * // Assert permission (throws if denied)
 * await authz.assertCan(userId, 'delete', 'device', deviceId);
 *
 * // Get role for a resource
 * const role = await authz.getRole(userId, 'wallet', walletId);
 * ```
 */

import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { ForbiddenError, UnauthorizedError } from '../../errors';
import { createNamespacedCache, type ICacheService } from '../cache';

const log = createLogger('Authorization');

// Cache TTL in seconds
const ROLE_CACHE_TTL = 60; // 1 minute - roles don't change frequently

// =============================================================================
// Types
// =============================================================================

/**
 * Resource types that can have authorization policies
 */
export type ResourceType = 'wallet' | 'device' | 'group' | 'user' | 'system';

/**
 * Actions that can be performed on resources
 */
export type Action = 'view' | 'edit' | 'delete' | 'share' | 'transfer' | 'admin';

/**
 * Role hierarchy (higher roles include lower roles' permissions)
 */
export type Role = 'none' | 'viewer' | 'signer' | 'owner' | 'admin';

/**
 * Authorization decision
 */
export interface AuthorizationDecision {
  allowed: boolean;
  role: Role;
  reason?: string;
}

/**
 * Policy definition
 */
export interface Policy {
  resource: ResourceType;
  action: Action;
  allowedRoles: Role[];
}

// =============================================================================
// Role Hierarchy
// =============================================================================

/**
 * Role hierarchy levels (higher number = more permissions)
 */
const ROLE_LEVELS: Record<Role, number> = {
  none: 0,
  viewer: 1,
  signer: 2,
  owner: 3,
  admin: 4,
};

/**
 * Check if a role is at least the required level
 */
function roleAtLeast(role: Role, required: Role): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS[required];
}

// =============================================================================
// Default Policies
// =============================================================================

/**
 * Default policies for each resource type and action
 */
const DEFAULT_POLICIES: Policy[] = [
  // Wallet policies
  { resource: 'wallet', action: 'view', allowedRoles: ['viewer', 'signer', 'owner', 'admin'] },
  { resource: 'wallet', action: 'edit', allowedRoles: ['signer', 'owner', 'admin'] },
  { resource: 'wallet', action: 'delete', allowedRoles: ['owner', 'admin'] },
  { resource: 'wallet', action: 'share', allowedRoles: ['owner', 'admin'] },
  { resource: 'wallet', action: 'transfer', allowedRoles: ['owner', 'admin'] },

  // Device policies
  { resource: 'device', action: 'view', allowedRoles: ['viewer', 'owner', 'admin'] },
  { resource: 'device', action: 'edit', allowedRoles: ['owner', 'admin'] },
  { resource: 'device', action: 'delete', allowedRoles: ['owner', 'admin'] },
  { resource: 'device', action: 'share', allowedRoles: ['owner', 'admin'] },
  { resource: 'device', action: 'transfer', allowedRoles: ['owner', 'admin'] },

  // Group policies
  { resource: 'group', action: 'view', allowedRoles: ['viewer', 'owner', 'admin'] },
  { resource: 'group', action: 'edit', allowedRoles: ['owner', 'admin'] },
  { resource: 'group', action: 'delete', allowedRoles: ['owner', 'admin'] },

  // User policies (for admin operations on users)
  { resource: 'user', action: 'view', allowedRoles: ['admin'] },
  { resource: 'user', action: 'edit', allowedRoles: ['admin'] },
  { resource: 'user', action: 'delete', allowedRoles: ['admin'] },

  // System policies
  { resource: 'system', action: 'admin', allowedRoles: ['admin'] },
];

// =============================================================================
// Authorization Service
// =============================================================================

class AuthorizationService {
  private policies: Map<string, Policy> = new Map();
  private cache: ICacheService;

  constructor() {
    // Load default policies
    for (const policy of DEFAULT_POLICIES) {
      const key = `${policy.resource}:${policy.action}`;
      this.policies.set(key, policy);
    }

    // Initialize cache namespace
    this.cache = createNamespacedCache('authz');
  }

  // =============================================================================
  // Cache Key Helpers
  // =============================================================================

  private roleKey(userId: string, resource: ResourceType, resourceId: string): string {
    return `role:${userId}:${resource}:${resourceId}`;
  }

  private isAdminKey(userId: string): string {
    return `admin:${userId}`;
  }

  /**
   * Get the user's role for a specific resource (with caching)
   */
  async getRole(userId: string, resource: ResourceType, resourceId: string): Promise<Role> {
    // Check cache first
    const cacheKey = this.roleKey(userId, resource, resourceId);
    const cached = await this.cache.get<Role>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Check if user is an admin (also cached)
    const isAdmin = await this.isUserAdmin(userId);
    if (isAdmin) {
      await this.cache.set(cacheKey, 'admin', ROLE_CACHE_TTL);
      return 'admin';
    }

    let role: Role;
    switch (resource) {
      case 'wallet':
        role = await this.getWalletRole(userId, resourceId);
        break;
      case 'device':
        role = await this.getDeviceRole(userId, resourceId);
        break;
      case 'group':
        role = await this.getGroupRole(userId, resourceId);
        break;
      case 'user':
        // Users can only view/edit themselves unless admin
        role = userId === resourceId ? 'owner' : 'none';
        break;
      case 'system':
        role = 'none'; // Only admins have system access
        break;
      default:
        role = 'none';
    }

    // Cache the result
    await this.cache.set(cacheKey, role, ROLE_CACHE_TTL);
    return role;
  }

  /**
   * Check if a user is an admin (cached)
   */
  private async isUserAdmin(userId: string): Promise<boolean> {
    const cacheKey = this.isAdminKey(userId);
    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    const isAdmin = user?.isAdmin ?? false;
    await this.cache.set(cacheKey, isAdmin, ROLE_CACHE_TTL);
    return isAdmin;
  }

  /**
   * Check if a user can perform an action on a resource
   */
  async can(
    userId: string,
    action: Action,
    resource: ResourceType,
    resourceId: string
  ): Promise<AuthorizationDecision> {
    const role = await this.getRole(userId, resource, resourceId);

    const policyKey = `${resource}:${action}`;
    const policy = this.policies.get(policyKey);

    if (!policy) {
      log.warn(`No policy found for ${policyKey}`);
      return { allowed: false, role, reason: 'No policy defined' };
    }

    const allowed = policy.allowedRoles.includes(role);

    if (!allowed) {
      log.debug('Authorization denied', { userId, action, resource, resourceId, role });
    }

    return {
      allowed,
      role,
      reason: allowed ? undefined : `Role '${role}' cannot perform '${action}' on '${resource}'`,
    };
  }

  /**
   * Assert that a user can perform an action (throws if denied)
   */
  async assertCan(
    userId: string,
    action: Action,
    resource: ResourceType,
    resourceId: string
  ): Promise<Role> {
    const decision = await this.can(userId, action, resource, resourceId);

    if (!decision.allowed) {
      throw new ForbiddenError(
        decision.reason || `You do not have permission to ${action} this ${resource}`,
        undefined,
        { resource, resourceId, action, role: decision.role }
      );
    }

    return decision.role;
  }

  /**
   * Check if user has at least the required role for a resource
   */
  async hasRole(
    userId: string,
    resource: ResourceType,
    resourceId: string,
    requiredRole: Role
  ): Promise<boolean> {
    const role = await this.getRole(userId, resource, resourceId);
    return roleAtLeast(role, requiredRole);
  }

  /**
   * Assert that user has at least the required role
   */
  async assertRole(
    userId: string,
    resource: ResourceType,
    resourceId: string,
    requiredRole: Role
  ): Promise<Role> {
    const role = await this.getRole(userId, resource, resourceId);

    if (!roleAtLeast(role, requiredRole)) {
      throw new ForbiddenError(
        `This action requires ${requiredRole} access`,
        undefined,
        { resource, resourceId, requiredRole, actualRole: role }
      );
    }

    return role;
  }

  /**
   * Ensure user is authenticated
   */
  assertAuthenticated(userId: string | undefined): asserts userId is string {
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
  }

  // =============================================================================
  // Private Methods - Role Resolution
  // =============================================================================

  private async getWalletRole(userId: string, walletId: string): Promise<Role> {
    // Check direct wallet membership
    const walletUser = await prisma.walletUser.findFirst({
      where: { walletId, userId },
      select: { role: true },
    });

    if (walletUser) {
      return this.mapWalletRole(walletUser.role);
    }

    // Check group membership
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        groupId: true,
        group: {
          select: {
            members: {
              where: { userId },
              select: { role: true },
            },
          },
        },
      },
    });

    if (wallet?.group?.members[0]) {
      const groupRole = wallet.group.members[0].role;
      // Group members get viewer access by default
      return groupRole === 'owner' ? 'signer' : 'viewer';
    }

    return 'none';
  }

  private async getDeviceRole(userId: string, deviceId: string): Promise<Role> {
    const deviceUser = await prisma.deviceUser.findFirst({
      where: { deviceId, userId },
      select: { role: true },
    });

    if (!deviceUser) {
      return 'none';
    }

    return deviceUser.role === 'owner' ? 'owner' : 'viewer';
  }

  private async getGroupRole(userId: string, groupId: string): Promise<Role> {
    const member = await prisma.groupMember.findFirst({
      where: { groupId, userId },
      select: { role: true },
    });

    if (!member) {
      return 'none';
    }

    return member.role === 'owner' ? 'owner' : 'viewer';
  }

  private mapWalletRole(role: string): Role {
    switch (role) {
      case 'owner':
        return 'owner';
      case 'signer':
        return 'signer';
      case 'viewer':
        return 'viewer';
      default:
        return 'none';
    }
  }

  // =============================================================================
  // Cache Invalidation
  // =============================================================================

  /**
   * Invalidate cached role for a user on a specific resource
   */
  async invalidateRole(userId: string, resource: ResourceType, resourceId: string): Promise<void> {
    const cacheKey = this.roleKey(userId, resource, resourceId);
    await this.cache.delete(cacheKey);
    log.debug('Invalidated role cache', { userId, resource, resourceId });
  }

  /**
   * Invalidate all cached roles for a user on a resource type
   */
  async invalidateUserRoles(userId: string, resource?: ResourceType): Promise<void> {
    const pattern = resource
      ? `role:${userId}:${resource}:*`
      : `role:${userId}:*`;
    await this.cache.deletePattern(pattern);
    log.debug('Invalidated user role cache', { userId, resource });
  }

  /**
   * Invalidate all cached roles for a resource (e.g., when sharing is modified)
   */
  async invalidateResourceRoles(resource: ResourceType, resourceId: string): Promise<void> {
    const pattern = `role:*:${resource}:${resourceId}`;
    await this.cache.deletePattern(pattern);
    log.debug('Invalidated resource role cache', { resource, resourceId });
  }

  /**
   * Invalidate admin status cache for a user
   */
  async invalidateAdminStatus(userId: string): Promise<void> {
    await this.cache.delete(this.isAdminKey(userId));
    // Also invalidate all role caches since admin status affects all roles
    await this.invalidateUserRoles(userId);
    log.debug('Invalidated admin status cache', { userId });
  }

  /**
   * Clear all authorization caches
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    log.info('Cleared all authorization caches');
  }

  // =============================================================================
  // Policy Management
  // =============================================================================

  /**
   * Register a custom policy
   */
  registerPolicy(policy: Policy): void {
    const key = `${policy.resource}:${policy.action}`;
    this.policies.set(key, policy);
    log.debug(`Registered policy: ${key}`);
  }

  /**
   * Get all registered policies
   */
  getPolicies(): Policy[] {
    return Array.from(this.policies.values());
  }
}

/**
 * Singleton authorization service instance
 */
export const authorizationService: AuthorizationService = new AuthorizationService();
