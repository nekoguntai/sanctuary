import { describe, it, expect, vi } from 'vitest';

const mockConnectDevice = () => null;

vi.mock('../../components/ConnectDevice/index', () => ({
  ConnectDevice: mockConnectDevice,
}));

describe('ConnectDevice backwards-compat export', () => {
  it('re-exports ConnectDevice from the refactored module', async () => {
    const mod = await import('../../components/ConnectDevice.tsx');
    expect(mod.ConnectDevice).toBe(mockConnectDevice);
  });
});
