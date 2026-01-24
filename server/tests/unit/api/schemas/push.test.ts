import { describe, it, expect } from 'vitest';
import {
  PlatformSchema,
  FcmTokenSchema,
  ApnsTokenSchema,
  RegisterDeviceSchema,
  GatewayAuditEventSchema,
} from '../../../../src/api/schemas/push';

describe('Push Schemas', () => {
  it('validates platform enum', () => {
    expect(PlatformSchema.safeParse('ios').success).toBe(true);
    expect(PlatformSchema.safeParse('android').success).toBe(true);
    expect(PlatformSchema.safeParse('web').success).toBe(false);
  });

  it('validates FCM token format', () => {
    const token = 'a'.repeat(120);
    expect(FcmTokenSchema.safeParse(token).success).toBe(true);
    expect(FcmTokenSchema.safeParse('short').success).toBe(false);
  });

  it('validates APNs token format', () => {
    const hexToken = 'a'.repeat(64);
    expect(ApnsTokenSchema.safeParse(hexToken).success).toBe(true);
    expect(ApnsTokenSchema.safeParse('invalid-token!').success).toBe(false);
  });

  it('validates device registration payload', () => {
    const result = RegisterDeviceSchema.safeParse({
      token: 'a'.repeat(120),
      platform: 'android',
      deviceName: 'Pixel',
    });
    expect(result.success).toBe(true);
  });

  it('validates gateway audit event', () => {
    const result = GatewayAuditEventSchema.safeParse({
      event: 'device-registered',
      category: 'gateway',
      severity: 'low',
      details: { key: 'value' },
    });
    expect(result.success).toBe(true);
  });
});
