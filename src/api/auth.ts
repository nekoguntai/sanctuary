/**
 * Authentication API
 *
 * API calls for user authentication and profile management
 */

import apiClient from './client';

export interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  preferences: {
    darkMode?: boolean;
    theme?: string;
    background?: string;
    unit?: string;
    fiatCurrency?: string;
    showFiat?: boolean;
    priceProvider?: string;
  };
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/**
 * Register a new user
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/register', data);

  // Set token in client
  apiClient.setToken(response.token);

  return response;
}

/**
 * Login user
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/login', data);

  // Set token in client
  apiClient.setToken(response.token);

  return response;
}

/**
 * Logout user
 */
export function logout(): void {
  apiClient.setToken(null);
}

/**
 * Get current user profile
 */
export async function getCurrentUser(): Promise<User> {
  return apiClient.get<User>('/auth/me');
}

/**
 * Update user preferences
 */
export async function updatePreferences(preferences: Partial<User['preferences']>): Promise<User> {
  return apiClient.patch<User>('/auth/me/preferences', preferences);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return apiClient.isAuthenticated();
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Change user password
 */
export async function changePassword(data: ChangePasswordRequest): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>('/auth/me/change-password', data);
}

export interface UserGroup {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  memberIds: string[];
}

/**
 * Get groups the current user is a member of
 */
export async function getUserGroups(): Promise<UserGroup[]> {
  return apiClient.get<UserGroup[]>('/auth/me/groups');
}

export interface SearchUser {
  id: string;
  username: string;
}

/**
 * Search users by username
 */
export async function searchUsers(query: string): Promise<SearchUser[]> {
  return apiClient.get<SearchUser[]>('/auth/users/search', { q: query });
}
