/**
 * Mobile Permissions Module Exports
 *
 * Mobile permissions act as additional restrictions on top of wallet roles.
 * They allow users to self-restrict their mobile access, and allow owners
 * to set maximum permission caps for other users.
 */

export { mobilePermissionService, default } from './mobilePermissionService';

export {
  type MobileAction,
  type WalletRole,
  type EffectivePermissions,
  type UpdatePermissionsInput,
  type OwnerMaxPermissionsInput,
  type PermissionCheckResult,
  ROLE_CAPABILITIES,
  ACTION_TO_FIELD,
  ALL_MOBILE_ACTIONS,
} from './types';
