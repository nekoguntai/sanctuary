import { useCallback, useRef } from 'react';
import { useUser } from '../contexts/UserContext';

/**
 * Hook for playing notification sounds
 * Uses Web Audio API to generate pleasant chime sounds
 */
export function useNotificationSound() {
  const { user } = useUser();
  const audioContextRef = useRef<AudioContext | null>(null);

  // Get or create AudioContext (lazy initialization)
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Play a gentle chime sound for transaction confirmation
   * Creates a pleasant bell-like tone using harmonics
   */
  const playConfirmationChime = useCallback(() => {
    const prefs = user?.preferences?.notificationSounds;

    // Check if sounds are enabled
    if (!prefs?.enabled || !prefs?.confirmationChime) {
      return;
    }

    try {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      const volume = (prefs.volume ?? 50) / 100;

      // Create a pleasant chime using multiple harmonics
      const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5 - C major chord
      const durations = [0.8, 0.6, 0.4]; // Staggered fade out

      frequencies.forEach((freq, i) => {
        // Oscillator for the tone
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        // Gain for envelope
        const gainNode = ctx.createGain();
        const startTime = now + i * 0.05; // Slight stagger for arpeggiated effect
        const duration = durations[i];

        // ADSR-like envelope for bell sound
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.01); // Quick attack
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.15, startTime + 0.1); // Decay
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration); // Sustain/Release

        // Connect and play
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      });

      // Add a subtle higher harmonic for shimmer
      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.value = 1046.5; // C6

      const shimmerGain = ctx.createGain();
      shimmerGain.gain.setValueAtTime(0, now);
      shimmerGain.gain.linearRampToValueAtTime(volume * 0.1, now + 0.02);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmer.start(now);
      shimmer.stop(now + 0.5);

    } catch (error) {
      console.warn('Failed to play notification sound:', error);
    }
  }, [user?.preferences?.notificationSounds, getAudioContext]);

  /**
   * Check if notification sounds are enabled
   */
  const isSoundEnabled = useCallback(() => {
    const prefs = user?.preferences?.notificationSounds;
    return prefs?.enabled && prefs?.confirmationChime;
  }, [user?.preferences?.notificationSounds]);

  return {
    playConfirmationChime,
    isSoundEnabled,
  };
}
