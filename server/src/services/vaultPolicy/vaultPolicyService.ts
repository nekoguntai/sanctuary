/**
 * Vault Policy Service
 *
 * Business logic for policy CRUD, inheritance resolution, and validation.
 */

import type { VaultPolicy, Prisma } from '../../generated/prisma/client';
import { policyRepository } from '../../repositories/policyRepository';
import { NotFoundError, ForbiddenError, InvalidInputError } from '../../errors';
import { createLogger } from '../../utils/logger';
import type {
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyType,
  PolicyConfig,
  SpendingLimitConfig,
  ApprovalRequiredConfig,
  TimeDelayConfig,
  AddressControlConfig,
  VelocityConfig,
  VALID_POLICY_TYPES,
  VALID_ENFORCEMENT_MODES,
} from './types';

const log = createLogger('VAULT_POLICY:SVC');

// ========================================
// POLICY CRUD
// ========================================

/**
 * Get all policies for a wallet, including inherited system and group policies
 */
export async function getWalletPolicies(
  walletId: string,
  options?: { includeInherited?: boolean; walletGroupId?: string | null }
): Promise<VaultPolicy[]> {
  const walletPolicies = await policyRepository.findAllPoliciesForWallet(walletId);

  if (!options?.includeInherited) {
    return walletPolicies;
  }

  // Fetch system-wide policies
  const systemPolicies = await policyRepository.findSystemPolicies();

  // Fetch group policies if wallet belongs to a group
  let groupPolicies: VaultPolicy[] = [];
  if (options.walletGroupId) {
    groupPolicies = await policyRepository.findGroupPolicies(options.walletGroupId);
  }

  // Merge: system first (highest authority), then group, then wallet
  return [...systemPolicies, ...groupPolicies, ...walletPolicies];
}

/**
 * Get active (enabled) policies for a wallet, including inherited
 */
export async function getActivePoliciesForWallet(
  walletId: string,
  walletGroupId?: string | null
): Promise<VaultPolicy[]> {
  const all = await getWalletPolicies(walletId, {
    includeInherited: true,
    walletGroupId,
  });
  return all.filter(p => p.enabled);
}

/**
 * Get a specific policy by ID
 */
export async function getPolicy(policyId: string): Promise<VaultPolicy> {
  const policy = await policyRepository.findPolicyById(policyId);
  if (!policy) {
    throw new NotFoundError('Policy not found');
  }
  return policy;
}

/**
 * Get a policy by ID within a specific wallet
 */
export async function getPolicyInWallet(
  policyId: string,
  walletId: string
): Promise<VaultPolicy> {
  const policy = await policyRepository.findPolicyByIdInWallet(policyId, walletId);
  if (!policy) {
    throw new NotFoundError('Policy not found');
  }
  return policy;
}

/**
 * Create a new vault policy
 */
export async function createPolicy(
  userId: string,
  input: CreatePolicyInput
): Promise<VaultPolicy> {
  validatePolicyInput(input);

  const sourceType = input.walletId ? 'wallet' : input.groupId ? 'group' : 'system';

  const policy = await policyRepository.createPolicy({
    walletId: input.walletId,
    groupId: input.groupId,
    name: input.name,
    description: input.description,
    type: input.type,
    config: input.config as unknown as Prisma.InputJsonValue,
    priority: input.priority ?? 0,
    enforcement: input.enforcement ?? 'enforce',
    enabled: input.enabled ?? true,
    createdBy: userId,
    sourceType,
  });

  log.info('Created vault policy', {
    policyId: policy.id,
    walletId: input.walletId,
    groupId: input.groupId,
    type: input.type,
    sourceType,
  });

  return policy;
}

/**
 * Update an existing vault policy
 */
export async function updatePolicy(
  policyId: string,
  userId: string,
  input: UpdatePolicyInput,
  options?: { isAdmin?: boolean }
): Promise<VaultPolicy> {
  const existing = await policyRepository.findPolicyById(policyId);
  if (!existing) {
    throw new NotFoundError('Policy not found');
  }

  // Non-admin callers cannot modify system or group policies
  if (!options?.isAdmin) {
    if (existing.sourceType === 'system') {
      throw new ForbiddenError('Cannot modify system policies');
    }
    if (existing.sourceType === 'group') {
      throw new ForbiddenError('Cannot modify group policies from wallet context');
    }
  }

  if (input.config !== undefined) {
    validatePolicyConfig(existing.type as PolicyType, input.config);
  }

  if (input.enforcement !== undefined) {
    const validModes = ['enforce', 'monitor'];
    if (!validModes.includes(input.enforcement)) {
      throw new InvalidInputError(`Invalid enforcement mode. Must be one of: ${validModes.join(', ')}`);
    }
  }

  const updated = await policyRepository.updatePolicy(policyId, {
    name: input.name,
    description: input.description,
    config: input.config as unknown as Prisma.InputJsonValue,
    priority: input.priority,
    enforcement: input.enforcement,
    enabled: input.enabled,
    updatedBy: userId,
  });

  log.info('Updated vault policy', { policyId, updatedFields: Object.keys(input) });

  return updated;
}

/**
 * Delete a vault policy
 */
export async function deletePolicy(policyId: string, walletId?: string): Promise<void> {
  const existing = await policyRepository.findPolicyById(policyId);
  if (!existing) {
    throw new NotFoundError('Policy not found');
  }

  // If walletId provided, verify the policy belongs to this wallet
  if (walletId && existing.walletId !== walletId) {
    throw new ForbiddenError('Policy does not belong to this wallet');
  }

  // Cannot delete inherited policies from wallet context
  if (walletId && existing.sourceType !== 'wallet') {
    throw new ForbiddenError('Cannot delete inherited policies from wallet context');
  }

  await policyRepository.removePolicy(policyId);

  log.info('Deleted vault policy', { policyId, walletId });
}

// ========================================
// SYSTEM & GROUP POLICIES (Admin)
// ========================================

export async function getSystemPolicies(): Promise<VaultPolicy[]> {
  return policyRepository.findSystemPolicies();
}

export async function getGroupPolicies(groupId: string): Promise<VaultPolicy[]> {
  return policyRepository.findGroupPolicies(groupId);
}

// ========================================
// VALIDATION
// ========================================

function validatePolicyInput(input: CreatePolicyInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new InvalidInputError('Policy name is required');
  }

  if (input.name.length > 100) {
    throw new InvalidInputError('Policy name must be 100 characters or fewer');
  }

  const validTypes: PolicyType[] = [
    'spending_limit',
    'approval_required',
    'time_delay',
    'address_control',
    'velocity',
  ];

  if (!validTypes.includes(input.type)) {
    throw new InvalidInputError(`Invalid policy type. Must be one of: ${validTypes.join(', ')}`);
  }

  if (input.enforcement !== undefined) {
    const validModes = ['enforce', 'monitor'];
    if (!validModes.includes(input.enforcement)) {
      throw new InvalidInputError(`Invalid enforcement mode. Must be one of: ${validModes.join(', ')}`);
    }
  }

  validatePolicyConfig(input.type, input.config);
}

function validatePolicyConfig(type: PolicyType, config: PolicyConfig): void {
  switch (type) {
    case 'spending_limit':
      validateSpendingLimitConfig(config as SpendingLimitConfig);
      break;
    case 'approval_required':
      validateApprovalRequiredConfig(config as ApprovalRequiredConfig);
      break;
    case 'time_delay':
      validateTimeDelayConfig(config as TimeDelayConfig);
      break;
    case 'address_control':
      validateAddressControlConfig(config as AddressControlConfig);
      break;
    case 'velocity':
      validateVelocityConfig(config as VelocityConfig);
      break;
    default:
      throw new InvalidInputError(`Unknown policy type: ${type}`);
  }
}

function validateSpendingLimitConfig(config: SpendingLimitConfig): void {
  if (!config.scope || !['wallet', 'per_user'].includes(config.scope)) {
    throw new InvalidInputError('spending_limit config requires scope: "wallet" or "per_user"');
  }

  const hasLimit = (config.perTransaction && config.perTransaction > 0)
    || (config.daily && config.daily > 0)
    || (config.weekly && config.weekly > 0)
    || (config.monthly && config.monthly > 0);

  if (!hasLimit) {
    throw new InvalidInputError('spending_limit config requires at least one non-zero limit');
  }
}

function validateApprovalRequiredConfig(config: ApprovalRequiredConfig): void {
  if (!config.trigger) {
    throw new InvalidInputError('approval_required config requires a trigger');
  }

  if (!config.trigger.always && !config.trigger.amountAbove && !config.trigger.unknownAddressesOnly) {
    throw new InvalidInputError('approval_required trigger must specify at least one condition');
  }

  if (typeof config.requiredApprovals !== 'number' || config.requiredApprovals < 1) {
    throw new InvalidInputError('requiredApprovals must be a positive integer');
  }

  const validQuorums = ['any_n', 'specific', 'all'];
  if (!validQuorums.includes(config.quorumType)) {
    throw new InvalidInputError(`quorumType must be one of: ${validQuorums.join(', ')}`);
  }

  if (config.quorumType === 'specific') {
    if (!config.specificApprovers || config.specificApprovers.length === 0) {
      throw new InvalidInputError('specific quorum requires specificApprovers array');
    }
  }
}

function validateTimeDelayConfig(config: TimeDelayConfig): void {
  if (!config.trigger) {
    throw new InvalidInputError('time_delay config requires a trigger');
  }

  if (typeof config.delayHours !== 'number' || config.delayHours <= 0) {
    throw new InvalidInputError('delayHours must be a positive number');
  }

  if (config.delayHours > 168) {
    throw new InvalidInputError('delayHours cannot exceed 168 (7 days)');
  }

  const validEligible = ['any_approver', 'specific'];
  if (!validEligible.includes(config.vetoEligible)) {
    throw new InvalidInputError(`vetoEligible must be one of: ${validEligible.join(', ')}`);
  }
}

function validateAddressControlConfig(config: AddressControlConfig): void {
  const validModes = ['allowlist', 'denylist'];
  if (!validModes.includes(config.mode)) {
    throw new InvalidInputError(`address_control mode must be one of: ${validModes.join(', ')}`);
  }

  if (typeof config.allowSelfSend !== 'boolean') {
    throw new InvalidInputError('allowSelfSend must be a boolean');
  }
}

function validateVelocityConfig(config: VelocityConfig): void {
  if (!config.scope || !['wallet', 'per_user'].includes(config.scope)) {
    throw new InvalidInputError('velocity config requires scope: "wallet" or "per_user"');
  }

  const hasLimit = (config.maxPerHour && config.maxPerHour > 0)
    || (config.maxPerDay && config.maxPerDay > 0)
    || (config.maxPerWeek && config.maxPerWeek > 0);

  if (!hasLimit) {
    throw new InvalidInputError('velocity config requires at least one non-zero limit');
  }
}

// ========================================
// EXPORTS
// ========================================

export const vaultPolicyService = {
  getWalletPolicies,
  getActivePoliciesForWallet,
  getPolicy,
  getPolicyInWallet,
  createPolicy,
  updatePolicy,
  deletePolicy,
  getSystemPolicies,
  getGroupPolicies,
};

export default vaultPolicyService;
