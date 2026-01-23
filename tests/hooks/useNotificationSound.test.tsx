import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useNotificationSound } from '../../hooks/useNotificationSound';

vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import * as UserContext from '../../contexts/UserContext';

const mockUseUser = vi.mocked(UserContext.useUser);

describe('useNotificationSound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when sounds disabled', () => {
    mockUseUser.mockReturnValue({ user: { preferences: { notificationSounds: { enabled: false } } } } as any);

    const { result } = renderHook(() => useNotificationSound());
    expect(result.current.isSoundEnabled()).toBe(false);
    expect(result.current.getEventConfig('confirmation')).toEqual({ enabled: false, sound: 'none' });
  });

  it('falls back to legacy confirmation config', () => {
    mockUseUser.mockReturnValue({
      user: {
        preferences: {
          notificationSounds: {
            enabled: true,
            confirmationChime: true,
            soundType: 'bell',
          },
        },
      },
    } as any);

    const { result } = renderHook(() => useNotificationSound());
    const config = result.current.getEventConfig('confirmation');
    expect(config.enabled).toBe(true);
    expect(config.sound).toBe('bell');
  });

  it('plays event sound when enabled', () => {
    const audioSpy = vi.spyOn(window, 'AudioContext');

    mockUseUser.mockReturnValue({
      user: {
        preferences: {
          notificationSounds: {
            enabled: true,
            volume: 60,
            confirmation: { enabled: true, sound: 'chime' },
          },
        },
      },
    } as any);

    const { result } = renderHook(() => useNotificationSound());
    result.current.playEventSound('confirmation');

    expect(audioSpy).toHaveBeenCalledTimes(1);
  });
});
