import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletSharing } from '../../../../components/WalletDetail/hooks/useWalletSharing';
import * as walletsApi from '../../../../src/api/wallets';
import * as devicesApi from '../../../../src/api/devices';
import * as authApi from '../../../../src/api/auth';
import { useErrorHandler } from '../../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../../contexts/AppNotificationContext';

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getWalletShareInfo: vi.fn(),
    shareWalletWithGroup: vi.fn(),
    shareWalletWithUser: vi.fn(),
    removeUserFromWallet: vi.fn(),
    getWallet: vi.fn(),
  };
});

vi.mock('../../../../src/api/devices', () => ({
  shareDeviceWithUser: vi.fn(),
}));

vi.mock('../../../../src/api/auth', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    searchUsers: vi.fn(),
  };
});

vi.mock('../../../../hooks/useErrorHandler', () => ({
  useErrorHandler: vi.fn(),
}));

vi.mock('../../../../contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

describe('useWalletSharing', () => {
  const handleError = vi.fn();
  const addNotification = vi.fn();
  const setWalletShareInfo = vi.fn();
  const setWallet = vi.fn();
  const onDataRefresh = vi.fn().mockResolvedValue(undefined);

  const baseShareInfo = {
    users: [{ id: 'owner-1', username: 'owner' }],
    group: null,
  };

  const renderSharingHook = () =>
    renderHook(() =>
      useWalletSharing({
        walletId: 'wallet-1',
        wallet: { id: 'wallet-1', name: 'Primary Wallet' } as any,
        devices: [],
        walletShareInfo: baseShareInfo as any,
        groups: [],
        onDataRefresh,
        setWalletShareInfo,
        setWallet,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({ handleError } as never);
    vi.mocked(useAppNotifications).mockReturnValue({ addNotification } as never);
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue(baseShareInfo as never);
    vi.mocked(walletsApi.shareWalletWithGroup).mockResolvedValue({ success: true } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({ devicesToShare: [] } as never);
    vi.mocked(walletsApi.removeUserFromWallet).mockResolvedValue(undefined as never);
    vi.mocked(walletsApi.getWallet).mockResolvedValue({ id: 'wallet-1', name: 'Reloaded' } as never);
    vi.mocked(authApi.searchUsers).mockResolvedValue([] as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockResolvedValue({ success: true } as never);
  });

  it('searches users and filters already shared users', async () => {
    vi.mocked(authApi.searchUsers).mockResolvedValue([
      { id: 'owner-1', username: 'owner' },
      { id: 'user-2', username: 'alice' },
    ] as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('al');
    });

    expect(authApi.searchUsers).toHaveBeenCalledWith('al');
    expect(result.current.userSearchResults).toEqual([{ id: 'user-2', username: 'alice' }]);
  });

  it('clears search results when query is too short', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('a');
    });

    expect(authApi.searchUsers).not.toHaveBeenCalled();
    expect(result.current.userSearchResults).toEqual([]);
  });

  it('adds a group and refreshes share info', async () => {
    const { result } = renderSharingHook();

    act(() => {
      result.current.setSelectedGroupToAdd('group-1');
    });

    await act(async () => {
      await result.current.addGroup('signer');
    });

    expect(walletsApi.shareWalletWithGroup).toHaveBeenCalledWith('wallet-1', {
      groupId: 'group-1',
      role: 'signer',
    });
    expect(walletsApi.getWalletShareInfo).toHaveBeenCalledWith('wallet-1');
    expect(setWalletShareInfo).toHaveBeenCalled();
    expect(result.current.selectedGroupToAdd).toBe('');
  });

  it('shares with user and opens device share prompt when needed', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1', label: 'Ledger' }],
    } as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2', 'viewer');
    });

    expect(walletsApi.shareWalletWithUser).toHaveBeenCalledWith('wallet-1', {
      targetUserId: 'user-2',
      role: 'viewer',
    });
    expect(result.current.deviceSharePrompt.show).toBe(true);
    expect(result.current.deviceSharePrompt.targetUsername).toBe('alice');
  });

  it('shares prompted devices and reports partial success', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }, { id: 'device-2' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser)
      .mockResolvedValueOnce({ success: true } as never)
      .mockRejectedValueOnce(new Error('network'));

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });

    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Partial Success',
      })
    );
    expect(result.current.deviceSharePrompt.show).toBe(false);
  });

  it('reports complete device-share failure through error handler', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockRejectedValue(new Error('all failed'));

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });

    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Device Share Failed');
  });

  it('removes user access and refreshes share info', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleRemoveUserAccess('user-2');
    });

    expect(walletsApi.removeUserFromWallet).toHaveBeenCalledWith('wallet-1', 'user-2');
    expect(walletsApi.getWalletShareInfo).toHaveBeenCalledWith('wallet-1');
  });

  it('reloads wallet and share info after transfer completion', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleTransferComplete();
    });

    expect(walletsApi.getWallet).toHaveBeenCalledWith('wallet-1');
    expect(setWallet).toHaveBeenCalledWith({ id: 'wallet-1', name: 'Reloaded' });
    expect(walletsApi.getWalletShareInfo).toHaveBeenCalledWith('wallet-1');
  });
});
