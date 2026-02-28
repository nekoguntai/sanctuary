import { describe, expect, it } from 'vitest';
import {
  AddGroupMemberSchema,
  CreateElectrumServerSchema,
  CreateUserSchema,
  SystemSettingsUpdateSchema,
} from '../../../../src/api/schemas/admin';
import {
  ChangePasswordSchema,
  PreferencesSchema,
  RegisterSchema,
  TotpCodeSchema,
} from '../../../../src/api/schemas/auth';
import {
  CreateDeviceSchema,
  DeviceModelFilterSchema,
  ShareDeviceWithGroupSchema,
} from '../../../../src/api/schemas/device';
import { SyncPrioritySchema, SyncWalletSchema } from '../../../../src/api/schemas/sync';

describe('Admin/Auth/Device/Sync Schemas', () => {
  it('validates admin user and electrum server payloads', () => {
    const user = CreateUserSchema.parse({
      username: 'test_user',
      password: 'StrongPass123',
      email: 'ADMIN@EXAMPLE.COM',
    });
    const server = CreateElectrumServerSchema.parse({
      label: 'Primary',
      host: 'electrum.example.com',
      port: '50002',
    });

    expect(user.email).toBe('admin@example.com');
    expect(user.isAdmin).toBe(false);
    expect(server.port).toBe(50002);
    expect(server.useSsl).toBe(true);
    expect(server.network).toBe('mainnet');
  });

  it('validates admin group member defaults and setting update constraints', () => {
    const member = AddGroupMemberSchema.parse({
      userId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(member.role).toBe('member');
    expect(SystemSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(SystemSettingsUpdateSchema.safeParse({ maintenanceMode: true }).success).toBe(true);
  });

  it('validates auth schemas and preference transforms', () => {
    const registration = RegisterSchema.parse({
      username: 'alice_123',
      password: 'SecurePass123',
      email: 'ALICE@EXAMPLE.COM',
    });
    const passwordChange = ChangePasswordSchema.parse({
      currentPassword: 'OldSecure123',
      newPassword: 'NewSecure123',
    });
    const preferences = PreferencesSchema.parse({
      fiatCurrency: 'usd',
      showFiat: true,
    });

    expect(registration.email).toBe('alice@example.com');
    expect(passwordChange.newPassword).toBe('NewSecure123');
    expect(preferences.fiatCurrency).toBe('USD');
    expect(TotpCodeSchema.safeParse('123456').success).toBe(true);
    expect(TotpCodeSchema.safeParse('abc123').success).toBe(false);
  });

  it('validates device schemas', () => {
    const device = CreateDeviceSchema.parse({
      type: 'ledger',
      label: 'Ledger Nano X',
      fingerprint: 'abcdef12',
      xpub: `xpub${'a'.repeat(79)}`,
      derivationPath: "m/84'/0'/0'",
    });
    const filters = DeviceModelFilterSchema.parse({
      airGapped: 'true',
      showDiscontinued: 0,
    });
    const shareGroup = ShareDeviceWithGroupSchema.parse({
      groupId: null,
    });

    expect(device.type).toBe('ledger');
    expect(filters.airGapped).toBe(true);
    expect(filters.showDiscontinued).toBe(false);
    expect(shareGroup.groupId).toBeNull();
  });

  it('validates sync schemas and defaults', () => {
    expect(SyncPrioritySchema.parse(undefined)).toBe('normal');
    expect(SyncWalletSchema.parse({})).toEqual({ priority: 'normal' });
    expect(SyncWalletSchema.parse({ priority: 'high' })).toEqual({ priority: 'high' });
  });
});
