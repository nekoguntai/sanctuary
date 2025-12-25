/**
 * Admin API
 *
 * API calls for admin-only functionality
 */

import apiClient, { API_BASE_URL } from './client';
import { NodeConfig, ElectrumServer } from '../../types';

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
  confirmationThreshold?: number;
  deepConfirmationThreshold?: number;
  dustThreshold?: number;
  // AI settings
  aiEnabled?: boolean;
  aiEndpoint?: string;
  aiModel?: string;
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

// ========================================
// BACKUP & RESTORE
// ========================================

/**
 * Backup metadata structure
 */
export interface BackupMeta {
  version: string;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
  description?: string;
  includesCache: boolean;
  recordCounts: Record<string, number>;
}

/**
 * Complete backup structure
 */
export interface SanctuaryBackup {
  meta: BackupMeta;
  data: Record<string, unknown[]>;
}

/**
 * Backup creation options
 */
export interface BackupOptions {
  includeCache?: boolean;
  description?: string;
}

/**
 * Validation result from backup validation
 */
export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  info: {
    createdAt: string;
    appVersion: string;
    schemaVersion: number;
    totalRecords: number;
    tables: string[];
  };
}

/**
 * Restore result
 */
export interface RestoreResult {
  success: boolean;
  message?: string;
  tablesRestored: number;
  recordsRestored: number;
  warnings: string[];
  error?: string;
}

/**
 * Create and download a database backup (admin only)
 *
 * This returns a Blob for file download.
 */
export async function createBackup(options?: BackupOptions): Promise<Blob> {
  const token = apiClient.getToken();

  const response = await fetch(`${API_BASE_URL}/admin/backup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(options || {}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Backup creation failed');
  }

  return response.blob();
}

/**
 * Create a backup and return as JSON object (for validation preview)
 */
export async function createBackupJson(options?: BackupOptions): Promise<SanctuaryBackup> {
  return apiClient.post<SanctuaryBackup>('/admin/backup', options || {});
}

/**
 * Validate a backup file before restore (admin only)
 */
export async function validateBackup(backup: SanctuaryBackup): Promise<ValidationResult> {
  return apiClient.post<ValidationResult>('/admin/backup/validate', { backup });
}

/**
 * Restore database from backup (admin only)
 *
 * WARNING: This will DELETE ALL existing data!
 */
export async function restoreBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
  return apiClient.post<RestoreResult>('/admin/restore', {
    backup,
    confirmationCode: 'CONFIRM_RESTORE',
  });
}

// ========================================
// AUDIT LOGS
// ========================================

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string;
  userId: string | null;
  username: string;
  action: string;
  category: string;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMsg: string | null;
  createdAt: string;
}

/**
 * Audit log query options
 */
export interface AuditLogQuery {
  userId?: string;
  username?: string;
  action?: string;
  category?: string;
  success?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Audit log query result
 */
export interface AuditLogResult {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Audit log statistics
 */
export interface AuditLogStats {
  totalEvents: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
  failedEvents: number;
}

/**
 * Get audit logs with optional filters (admin only)
 */
export async function getAuditLogs(query?: AuditLogQuery): Promise<AuditLogResult> {
  const params = new URLSearchParams();
  if (query) {
    if (query.userId) params.set('userId', query.userId);
    if (query.username) params.set('username', query.username);
    if (query.action) params.set('action', query.action);
    if (query.category) params.set('category', query.category);
    if (query.success !== undefined) params.set('success', String(query.success));
    if (query.startDate) params.set('startDate', query.startDate);
    if (query.endDate) params.set('endDate', query.endDate);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
  }
  const queryString = params.toString();
  const url = queryString ? `/admin/audit-logs?${queryString}` : '/admin/audit-logs';
  return apiClient.get<AuditLogResult>(url);
}

/**
 * Get audit log statistics (admin only)
 */
export async function getAuditLogStats(days?: number): Promise<AuditLogStats> {
  const url = days ? `/admin/audit-logs/stats?days=${days}` : '/admin/audit-logs/stats';
  return apiClient.get<AuditLogStats>(url);
}

// ========================================
// VERSION CHECK
// ========================================

/**
 * Version check response
 */
export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
  releaseNotes: string;
}

/**
 * Check for application updates
 * Does not require authentication
 */
export async function checkVersion(): Promise<VersionInfo> {
  return apiClient.get<VersionInfo>('/admin/version');
}

// ========================================
// ELECTRUM SERVER MANAGEMENT
// ========================================

/**
 * Get all Electrum servers, optionally filtered by network
 */
export async function getElectrumServers(network?: string): Promise<ElectrumServer[]> {
  const params = network ? `?network=${network}` : '';
  return apiClient.get<ElectrumServer[]>(`/admin/electrum-servers${params}`);
}

/**
 * Add a new Electrum server
 */
export async function addElectrumServer(server: Omit<ElectrumServer, 'id' | 'nodeConfigId' | 'createdAt' | 'updatedAt'>): Promise<ElectrumServer> {
  return apiClient.post<ElectrumServer>('/admin/electrum-servers', server);
}

/**
 * Update an Electrum server
 */
export async function updateElectrumServer(id: string, data: Partial<ElectrumServer>): Promise<ElectrumServer> {
  return apiClient.put<ElectrumServer>(`/admin/electrum-servers/${id}`, data);
}

/**
 * Delete an Electrum server
 */
export async function deleteElectrumServer(id: string): Promise<{ success: boolean; message: string }> {
  return apiClient.delete<{ success: boolean; message: string }>(`/admin/electrum-servers/${id}`);
}

/**
 * Test an Electrum server connection
 */
export async function testElectrumServer(id: string): Promise<{
  success: boolean;
  message: string;
  blockHeight?: number;
  serverVersion?: string;
}> {
  return apiClient.post(`/admin/electrum-servers/${id}/test`);
}

/**
 * Reorder Electrum server priorities
 */
export async function reorderElectrumServers(serverIds: string[]): Promise<ElectrumServer[]> {
  return apiClient.put<ElectrumServer[]>('/admin/electrum-servers/reorder', { serverIds });
}

/**
 * Test SOCKS5 proxy connection
 */
export async function testProxy(config: {
  host: string;
  port: number;
  username?: string;
  password?: string;
  targetHost?: string;
  targetPort?: number;
}): Promise<{
  success: boolean;
  message: string;
}> {
  return apiClient.post('/admin/proxy/test', config);
}

// ========================================
// TOR CONTAINER MANAGEMENT
// ========================================

/**
 * Tor container status response
 */
export interface TorContainerStatus {
  available: boolean;  // Docker proxy available
  exists: boolean;     // Container exists
  running: boolean;    // Container is running
  status: string;      // Container state (running, exited, etc.)
  message?: string;
}

/**
 * Container action response
 */
export interface ContainerActionResponse {
  success: boolean;
  message: string;
}

/**
 * Get the status of the bundled Tor container
 */
export async function getTorContainerStatus(): Promise<TorContainerStatus> {
  return apiClient.get<TorContainerStatus>('/admin/tor-container/status');
}

/**
 * Start the bundled Tor container
 */
export async function startTorContainer(): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>('/admin/tor-container/start', {});
}

/**
 * Stop the bundled Tor container
 */
export async function stopTorContainer(): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>('/admin/tor-container/stop', {});
}
