/**
 * Admin API
 *
 * API calls for admin-only functionality
 */

import apiClient from './client';
import { NodeConfig } from '../../types';

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email?: string;
  isAdmin?: boolean;
}

export interface UpdateUserRequest {
  username?: string;
  password?: string;
  email?: string;
  isAdmin?: boolean;
}

export interface GroupMember {
  userId: string;
  username: string;
  role: string;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  createdAt: string;
  updatedAt?: string;
  members: GroupMember[];
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  purpose?: string;
  memberIds?: string[];
}

/**
 * Get global node configuration (admin only)
 */
export async function getNodeConfig(): Promise<NodeConfig> {
  return apiClient.get<NodeConfig>('/admin/node-config');
}

/**
 * Update global node configuration (admin only)
 */
export async function updateNodeConfig(config: NodeConfig): Promise<NodeConfig> {
  return apiClient.put<NodeConfig>('/admin/node-config', config);
}

/**
 * Test node connection with provided configuration (admin only)
 */
export async function testNodeConfig(config: NodeConfig): Promise<{
  success: boolean;
  serverInfo?: string;
  protocol?: string;
  blockHeight?: number;
  message: string;
  error?: string;
}> {
  return apiClient.post('/admin/node-config/test', config);
}

// ========================================
// USER MANAGEMENT
// ========================================

/**
 * Get all users (admin only)
 */
export async function getUsers(): Promise<AdminUser[]> {
  return apiClient.get<AdminUser[]>('/admin/users');
}

/**
 * Create a new user (admin only)
 */
export async function createUser(data: CreateUserRequest): Promise<AdminUser> {
  return apiClient.post<AdminUser>('/admin/users', data);
}

/**
 * Update a user (admin only)
 */
export async function updateUser(userId: string, data: UpdateUserRequest): Promise<AdminUser> {
  return apiClient.put<AdminUser>(`/admin/users/${userId}`, data);
}

/**
 * Delete a user (admin only)
 */
export async function deleteUser(userId: string): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(`/admin/users/${userId}`);
}

// ========================================
// GROUP MANAGEMENT
// ========================================

/**
 * Get all groups (admin only)
 */
export async function getGroups(): Promise<AdminGroup[]> {
  return apiClient.get<AdminGroup[]>('/admin/groups');
}

/**
 * Create a new group (admin only)
 */
export async function createGroup(data: CreateGroupRequest): Promise<AdminGroup> {
  return apiClient.post<AdminGroup>('/admin/groups', data);
}

/**
 * Update a group (admin only)
 */
export async function updateGroup(groupId: string, data: Partial<CreateGroupRequest>): Promise<AdminGroup> {
  return apiClient.put<AdminGroup>(`/admin/groups/${groupId}`, data);
}

/**
 * Delete a group (admin only)
 */
export async function deleteGroup(groupId: string): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(`/admin/groups/${groupId}`);
}

/**
 * Add a member to a group (admin only)
 */
export async function addGroupMember(groupId: string, userId: string, role?: string): Promise<GroupMember> {
  return apiClient.post<GroupMember>(`/admin/groups/${groupId}/members`, { userId, role });
}

/**
 * Remove a member from a group (admin only)
 */
export async function removeGroupMember(groupId: string, userId: string): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(`/admin/groups/${groupId}/members/${userId}`);
}

// ========================================
// SYSTEM SETTINGS
// ========================================

export interface SystemSettings {
  registrationEnabled: boolean;
}

/**
 * Get all system settings (admin only)
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  return apiClient.get<SystemSettings>('/admin/settings');
}

/**
 * Update system settings (admin only)
 */
export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  return apiClient.put<SystemSettings>('/admin/settings', settings);
}
