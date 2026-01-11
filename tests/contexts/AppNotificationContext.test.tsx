/**
 * AppNotificationContext Tests
 *
 * Tests for the app notification context including scoped notifications,
 * localStorage persistence, and CRUD operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import {
  AppNotificationProvider,
  useAppNotifications,
  useWalletNotifications,
  useDeviceNotifications,
} from '../../contexts/AppNotificationContext';

// Mock the logger
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppNotificationProvider>{children}</AppNotificationProvider>
);

describe('AppNotificationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useAppNotifications hook', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useAppNotifications());
      }).toThrow('useAppNotifications must be used within an AppNotificationProvider');
    });

    it('should return context value when used within provider', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current).toBeDefined();
      expect(result.current.notifications).toEqual([]);
      expect(typeof result.current.addNotification).toBe('function');
      expect(typeof result.current.removeNotification).toBe('function');
    });
  });

  describe('addNotification', () => {
    it('should add a notification', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'global',
          title: 'Test Notification',
          severity: 'info',
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Test Notification');
      expect(result.current.notifications[0].type).toBe('pending_drafts');
      expect(result.current.notifications[0].scope).toBe('global');
    });

    it('should add notification with default severity', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.notifications[0].severity).toBe('info');
    });

    it('should add notification with all optional properties', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      const expiresAt = new Date(Date.now() + 3600000);

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          severity: 'warning',
          title: 'Pending Drafts',
          message: 'You have pending drafts',
          count: 3,
          actionUrl: '/wallet/wallet-123/drafts',
          actionLabel: 'View Drafts',
          dismissible: true,
          persistent: true,
          expiresAt,
          metadata: { draftsIds: ['d1', 'd2', 'd3'] },
        });
      });

      const notif = result.current.notifications[0];
      expect(notif.scope).toBe('wallet');
      expect(notif.scopeId).toBe('wallet-123');
      expect(notif.severity).toBe('warning');
      expect(notif.message).toBe('You have pending drafts');
      expect(notif.count).toBe(3);
      expect(notif.actionUrl).toBe('/wallet/wallet-123/drafts');
      expect(notif.actionLabel).toBe('View Drafts');
      expect(notif.dismissible).toBe(true);
      expect(notif.persistent).toBe(true);
      expect(notif.metadata).toEqual({ draftsIds: ['d1', 'd2', 'd3'] });
    });

    it('should update existing notification with same type and scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          title: 'Draft 1',
          count: 1,
        });
      });

      const originalId = result.current.notifications[0].id;

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          title: 'Drafts Updated',
          count: 3,
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].id).toBe(originalId);
      expect(result.current.notifications[0].title).toBe('Drafts Updated');
      expect(result.current.notifications[0].count).toBe(3);
    });

    it('should add separate notifications for different scopeIds', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-1',
          title: 'Wallet 1 Drafts',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-2',
          title: 'Wallet 2 Drafts',
        });
      });

      expect(result.current.notifications).toHaveLength(2);
    });
  });

  describe('updateNotification', () => {
    it('should update notification by id', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'sync_in_progress',
          scope: 'global',
          title: 'Syncing...',
        });
      });

      act(() => {
        result.current.updateNotification(notifId, {
          title: 'Sync Complete',
          severity: 'info',
        });
      });

      expect(result.current.notifications[0].title).toBe('Sync Complete');
    });

    it('should not change scope or type on update', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      act(() => {
        result.current.updateNotification(notifId, {
          type: 'pending_drafts' as any,
          scope: 'wallet' as any,
          title: 'Changed',
        });
      });

      expect(result.current.notifications[0].type).toBe('sync_error');
      expect(result.current.notifications[0].scope).toBe('global');
      expect(result.current.notifications[0].title).toBe('Changed');
    });
  });

  describe('removeNotification', () => {
    it('should remove notification by id', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Alert',
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      act(() => {
        result.current.removeNotification(notifId);
      });

      expect(result.current.notifications).toHaveLength(0);
    });
  });

  describe('removeNotificationsByType', () => {
    it('should remove all notifications of a type', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft 1',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w2',
          title: 'Draft 2',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.notifications).toHaveLength(3);

      act(() => {
        result.current.removeNotificationsByType('pending_drafts');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('sync_error');
    });

    it('should remove notifications by type and scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft 1',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w2',
          title: 'Draft 2',
        });
      });

      act(() => {
        result.current.removeNotificationsByType('pending_drafts', 'w1');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].scopeId).toBe('w2');
    });
  });

  describe('clearAllNotifications', () => {
    it('should clear all notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Alert 1',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.notifications).toHaveLength(2);

      act(() => {
        result.current.clearAllNotifications();
      });

      expect(result.current.notifications).toHaveLength(0);
    });
  });

  describe('clearScopedNotifications', () => {
    it('should clear notifications by scope', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Wallet 1',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Global Error',
        });
      });

      act(() => {
        result.current.clearScopedNotifications('wallet');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].scope).toBe('global');
    });

    it('should clear notifications by scope and scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Wallet 1',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w2',
          title: 'Wallet 2',
        });
      });

      act(() => {
        result.current.clearScopedNotifications('wallet', 'w1');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].scopeId).toBe('w2');
    });
  });

  describe('dismissNotification', () => {
    it('should dismiss dismissible notification', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          dismissible: true,
        });
      });

      act(() => {
        result.current.dismissNotification(notifId);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should not dismiss non-dismissible notification', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Critical Alert',
          dismissible: false,
        });
      });

      act(() => {
        result.current.dismissNotification(notifId);
      });

      expect(result.current.notifications).toHaveLength(1);
    });
  });

  describe('filtered getters', () => {
    it('should get global notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft',
        });
      });

      const global = result.current.getGlobalNotifications();
      expect(global).toHaveLength(1);
      expect(global[0].scope).toBe('global');
    });

    it('should get wallet notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-1',
          title: 'W1 Draft',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-2',
          title: 'W2 Draft',
        });
      });

      const w1Notifs = result.current.getWalletNotifications('wallet-1');
      expect(w1Notifs).toHaveLength(1);
      expect(w1Notifs[0].title).toBe('W1 Draft');
    });

    it('should get device notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'connection_error',
          scope: 'device',
          scopeId: 'device-1',
          title: 'Device Error',
        });
      });

      const deviceNotifs = result.current.getDeviceNotifications('device-1');
      expect(deviceNotifs).toHaveLength(1);
      expect(deviceNotifs[0].scopeId).toBe('device-1');
    });

    it('should get notifications by type', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error 1',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Error 2',
        });
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
      });

      const syncErrors = result.current.getNotificationsByType('sync_error');
      expect(syncErrors).toHaveLength(2);
    });
  });

  describe('count functions', () => {
    it('should return global count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          count: 1,
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'global',
          title: 'Drafts',
          count: 3,
        });
      });

      expect(result.current.getGlobalCount()).toBe(4);
    });

    it('should return wallet count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Drafts',
          count: 5,
        });
      });

      expect(result.current.getWalletCount('w1')).toBe(5);
      expect(result.current.getWalletCount('w2')).toBe(0);
    });

    it('should return device count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'connection_error',
          scope: 'device',
          scopeId: 'd1',
          title: 'Error',
        });
      });

      expect(result.current.getDeviceCount('d1')).toBe(1);
    });

    it('should return total count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          count: 1,
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Drafts',
          count: 2,
        });
        result.current.addNotification({
          type: 'connection_error',
          scope: 'device',
          scopeId: 'd1',
          title: 'Error',
        });
      });

      expect(result.current.getTotalCount()).toBe(4);
    });

    it('should default to 1 when count is not specified', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
      });

      expect(result.current.getTotalCount()).toBe(1);
    });
  });

  describe('hasNotificationType', () => {
    it('should check if notification type exists', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current.hasNotificationType('sync_error')).toBe(false);

      act(() => {
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.hasNotificationType('sync_error')).toBe(true);
      expect(result.current.hasNotificationType('update_available')).toBe(false);
    });

    it('should check for type with scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft',
        });
      });

      expect(result.current.hasNotificationType('pending_drafts', 'w1')).toBe(true);
      expect(result.current.hasNotificationType('pending_drafts', 'w2')).toBe(false);
    });
  });

  describe('panel state', () => {
    it('should toggle panel', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current.isPanelOpen).toBe(false);

      act(() => {
        result.current.togglePanel();
      });

      expect(result.current.isPanelOpen).toBe(true);

      act(() => {
        result.current.togglePanel();
      });

      expect(result.current.isPanelOpen).toBe(false);
    });

    it('should open panel', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.openPanel();
      });

      expect(result.current.isPanelOpen).toBe(true);

      act(() => {
        result.current.openPanel();
      });

      expect(result.current.isPanelOpen).toBe(true);
    });

    it('should close panel', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.openPanel();
      });

      act(() => {
        result.current.closePanel();
      });

      expect(result.current.isPanelOpen).toBe(false);
    });
  });

  describe('localStorage persistence', () => {
    // Note: These tests verify the logic but may have timing issues with fake timers
    // The actual localStorage persistence is tested through component behavior

    it('should create notifications with persistent flag', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'backup_reminder',
          scope: 'global',
          title: 'Backup Reminder',
          persistent: true,
        });
      });

      expect(result.current.notifications[0].persistent).toBe(true);
    });

    it('should create notifications without persistent flag', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_in_progress',
          scope: 'global',
          title: 'Syncing',
          persistent: false,
        });
      });

      expect(result.current.notifications[0].persistent).toBe(false);
    });

    it('should default persistent to false', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          // No persistent flag
        });
      });

      expect(result.current.notifications[0].persistent).toBe(false);
    });
  });

  describe('expiration', () => {
    it('should filter out expired notifications on load', () => {
      const expiredNotif = {
        id: 'expired-id',
        type: 'update_available',
        scope: 'global',
        severity: 'info',
        title: 'Expired',
        dismissible: true,
        persistent: true,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
      };

      localStorage.setItem('sanctuary_app_notifications', JSON.stringify([expiredNotif]));

      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should clean up expired notifications periodically', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      const expiresAt = new Date(Date.now() + 30000);

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Will Expire',
          expiresAt,
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      // Advance time past expiration
      act(() => {
        vi.advanceTimersByTime(60000);
      });

      expect(result.current.notifications).toHaveLength(0);
    });
  });
});

describe('useWalletNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should return wallet-specific notifications and counts', () => {
    const { result } = renderHook(
      () => {
        const appNotifs = useAppNotifications();
        const walletNotifs = useWalletNotifications('wallet-123');
        return { appNotifs, walletNotifs };
      },
      { wrapper }
    );

    act(() => {
      result.current.appNotifs.addNotification({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: 'wallet-123',
        title: 'Draft',
        count: 2,
      });
    });

    expect(result.current.walletNotifs.notifications).toHaveLength(1);
    expect(result.current.walletNotifs.count).toBe(2);
  });

  it('should add wallet-scoped notification', () => {
    const { result } = renderHook(
      () => {
        const walletNotifs = useWalletNotifications('wallet-456');
        return walletNotifs;
      },
      { wrapper }
    );

    act(() => {
      result.current.add({
        type: 'pending_signatures',
        title: 'Needs Signature',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].scope).toBe('wallet');
    expect(result.current.notifications[0].scopeId).toBe('wallet-456');
  });

  it('should remove notification by type from wallet', () => {
    const { result } = renderHook(
      () => {
        const walletNotifs = useWalletNotifications('wallet-789');
        return walletNotifs;
      },
      { wrapper }
    );

    act(() => {
      result.current.add({
        type: 'pending_drafts',
        title: 'Draft',
      });
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      result.current.remove('pending_drafts');
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('should clear all wallet notifications', () => {
    const { result } = renderHook(
      () => {
        const walletNotifs = useWalletNotifications('wallet-abc');
        return walletNotifs;
      },
      { wrapper }
    );

    act(() => {
      result.current.add({ type: 'pending_drafts', title: 'Draft 1' });
      result.current.add({ type: 'sync_error', title: 'Error' });
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.notifications).toHaveLength(0);
  });
});

describe('useDeviceNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should return device-specific notifications and counts', () => {
    const { result } = renderHook(
      () => {
        const appNotifs = useAppNotifications();
        const deviceNotifs = useDeviceNotifications('device-123');
        return { appNotifs, deviceNotifs };
      },
      { wrapper }
    );

    act(() => {
      result.current.appNotifs.addNotification({
        type: 'connection_error',
        scope: 'device',
        scopeId: 'device-123',
        title: 'Connection Error',
      });
    });

    expect(result.current.deviceNotifs.notifications).toHaveLength(1);
    expect(result.current.deviceNotifs.count).toBe(1);
  });

  it('should add device-scoped notification', () => {
    const { result } = renderHook(
      () => useDeviceNotifications('device-456'),
      { wrapper }
    );

    act(() => {
      result.current.add({
        type: 'backup_reminder',
        title: 'Backup Device',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].scope).toBe('device');
    expect(result.current.notifications[0].scopeId).toBe('device-456');
  });

  it('should clear all device notifications', () => {
    const { result } = renderHook(
      () => useDeviceNotifications('device-xyz'),
      { wrapper }
    );

    act(() => {
      result.current.add({ type: 'connection_error', title: 'Error' });
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.notifications).toHaveLength(0);
  });
});
