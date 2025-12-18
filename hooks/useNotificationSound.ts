import { useCallback, useRef } from 'react';
import { useUser } from '../contexts/UserContext';
import type { SoundType, EventSoundConfig } from '../types';

/**
 * Sound preset definitions
 * Each preset creates a unique audio experience using Web Audio API
 */
const SOUND_PRESETS: Record<Exclude<SoundType, 'none'>, {
  name: string;
  description: string;
  play: (ctx: AudioContext, volume: number) => void;
}> = {
  chime: {
    name: 'Chime',
    description: 'Pleasant chord arpeggio',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // C major chord arpeggio: C5, E5, G5, C6
      const frequencies = [523.25, 659.25, 783.99, 1046.5];
      const durations = [0.8, 0.7, 0.6, 0.5];

      frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.08;
        const duration = durations[i];

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.25, startTime + 0.015);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.12, startTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      });
    },
  },

  bell: {
    name: 'Bell',
    description: 'Classic bell tone',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Bell harmonics based on a strike note
      const fundamental = 880; // A5
      const harmonics = [1, 2.4, 3, 4.5, 5.2]; // Bell harmonic ratios
      const amplitudes = [1, 0.6, 0.4, 0.25, 0.2];

      harmonics.forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = fundamental * ratio;

        const gainNode = ctx.createGain();
        const amp = amplitudes[i] * volume * 0.15;

        // Bell envelope - quick attack, long decay
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(amp, now + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(amp * 0.7, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.5);
      });
    },
  },

  coin: {
    name: 'Coin',
    description: 'Playful coin sound',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Rising arpeggio like collecting a coin
      const notes = [987.77, 1174.66, 1318.51, 1567.98]; // B5, D6, E6, G6

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;

        // Low-pass filter to soften square wave
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3000;

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.07;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.12, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
      });

      // Final shimmer
      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.value = 2093; // C7

      const shimmerGain = ctx.createGain();
      const shimmerStart = now + 0.28;
      shimmerGain.gain.setValueAtTime(0, shimmerStart);
      shimmerGain.gain.linearRampToValueAtTime(volume * 0.1, shimmerStart + 0.02);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, shimmerStart + 0.3);

      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmer.start(shimmerStart);
      shimmer.stop(shimmerStart + 0.3);
    },
  },

  success: {
    name: 'Success',
    description: 'Triumphant fanfare',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Fanfare: two-part ascending melody
      const melody = [
        { freq: 523.25, start: 0, dur: 0.15 },      // C5
        { freq: 659.25, start: 0.12, dur: 0.15 },   // E5
        { freq: 783.99, start: 0.24, dur: 0.3 },    // G5 (held)
        { freq: 1046.5, start: 0.5, dur: 0.5 },     // C6 (final, longer)
      ];

      melody.forEach(({ freq, start, dur }) => {
        // Main tone
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        const startTime = now + start;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.2, startTime + 0.02);
        gainNode.gain.setValueAtTime(volume * 0.18, startTime + dur * 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.1);

        // Octave doubling for richness
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2;

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(volume * 0.08, startTime + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.8);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(startTime);
        osc2.stop(startTime + dur);
      });
    },
  },

  gentle: {
    name: 'Gentle',
    description: 'Soft notification',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Soft two-note chime
      const notes = [
        { freq: 440, start: 0, dur: 0.6 },      // A4
        { freq: 554.37, start: 0.15, dur: 0.5 }, // C#5 (major third)
      ];

      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        // Low-pass filter for softness
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        filter.Q.value = 0.5;

        const gainNode = ctx.createGain();
        const startTime = now + start;

        // Very gentle envelope
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.08, startTime + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.1);
      });
    },
  },

  zen: {
    name: 'Zen',
    description: 'Peaceful meditation tone',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Tibetan bowl-like sound with beating frequencies
      const fundamental = 256; // C4 - grounding frequency

      // Two slightly detuned oscillators for natural beating
      [fundamental, fundamental * 1.002].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume * 0.12, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 0.1, now + 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 2.5);
      });

      // Add harmonic overtone
      const harmonic = ctx.createOscillator();
      harmonic.type = 'sine';
      harmonic.frequency.value = fundamental * 3; // Fifth harmonic

      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0, now);
      harmGain.gain.linearRampToValueAtTime(volume * 0.04, now + 0.15);
      harmGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

      harmonic.connect(harmGain);
      harmGain.connect(ctx.destination);
      harmonic.start(now);
      harmonic.stop(now + 1.5);
    },
  },

  ping: {
    name: 'Ping',
    description: 'Quick, clean ping',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1800;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + 0.005);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      // Second ping slightly delayed and higher
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 2400;

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(volume * 0.2, now + 0.085);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    },
  },

  pop: {
    name: 'Pop',
    description: 'Bubbly pop sound',
    play: (ctx, volume) => {
      const now = ctx.currentTime;

      // Frequency sweep for pop effect
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.1);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.4, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      // Second pop
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(600, now + 0.1);
      osc2.frequency.exponentialRampToValueAtTime(200, now + 0.2);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0, now + 0.1);
      gain2.gain.linearRampToValueAtTime(volume * 0.25, now + 0.11);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.3);
    },
  },

  harp: {
    name: 'Harp',
    description: 'Ethereal harp glissando',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Pentatonic scale for pleasant harp sound
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C5 pentatonic-ish

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        // Slight vibrato for realism
        const vibrato = ctx.createOscillator();
        vibrato.type = 'sine';
        vibrato.frequency.value = 5;
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.value = 3;
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        const gainNode = ctx.createGain();
        const startTime = now + i * 0.06;
        const duration = 0.8 - i * 0.08;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.08, startTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        vibrato.start(startTime);
        vibrato.stop(startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.1);
      });
    },
  },

  retro: {
    name: 'Retro',
    description: '8-bit style blips',
    play: (ctx, volume) => {
      const now = ctx.currentTime;
      // Classic 8-bit ascending sound
      const notes = [
        { freq: 440, dur: 0.08 },
        { freq: 554, dur: 0.08 },
        { freq: 659, dur: 0.08 },
        { freq: 880, dur: 0.15 },
      ];

      let time = now;
      notes.forEach(({ freq, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;

        // Bit crusher effect via low sample rate oscillator
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 4000;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(volume * 0.12, time);
        gainNode.gain.setValueAtTime(0.001, time + dur - 0.01);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + dur);

        time += dur;
      });
    },
  },
};

// Event types that can have custom sounds
export type SoundEvent = 'confirmation' | 'receive' | 'send';

// Default sounds for each event
const DEFAULT_EVENT_SOUNDS: Record<SoundEvent, EventSoundConfig> = {
  confirmation: { enabled: true, sound: 'chime' },
  receive: { enabled: true, sound: 'coin' },
  send: { enabled: true, sound: 'success' },
};

// Event display info for settings UI
export const SOUND_EVENTS: Array<{
  id: SoundEvent;
  name: string;
  description: string;
}> = [
  { id: 'confirmation', name: 'Confirmation', description: 'When a transaction confirms' },
  { id: 'receive', name: 'Receive', description: 'When Bitcoin is received' },
  { id: 'send', name: 'Send', description: 'When a transaction is broadcast' },
];

/**
 * Get all available sound presets for the settings UI
 */
export function getSoundPresets(): Array<{ id: SoundType; name: string; description: string }> {
  const presets = Object.entries(SOUND_PRESETS).map(([id, preset]) => ({
    id: id as SoundType,
    name: preset.name,
    description: preset.description,
  }));
  // Add 'none' option
  presets.push({ id: 'none', name: 'None', description: 'No sound' });
  return presets;
}

/**
 * Hook for playing notification sounds
 * Uses Web Audio API to generate pleasant sounds
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
   * Play a specific sound type
   */
  const playSound = useCallback((soundType: SoundType, volumeOverride?: number) => {
    if (soundType === 'none') return;

    try {
      const ctx = getAudioContext();
      const volume = (volumeOverride ?? 50) / 100;
      const preset = SOUND_PRESETS[soundType];

      if (preset) {
        preset.play(ctx, volume);
      }
    } catch (error) {
      console.warn('Failed to play notification sound:', error);
    }
  }, [getAudioContext]);

  /**
   * Get the event sound configuration with fallbacks
   */
  const getEventConfig = useCallback((event: SoundEvent): EventSoundConfig => {
    const prefs = user?.preferences?.notificationSounds;
    if (!prefs?.enabled) {
      return { enabled: false, sound: 'none' };
    }

    // Check for new per-event config
    const eventConfig = prefs[event];
    if (eventConfig) {
      return eventConfig;
    }

    // Fallback to legacy config for confirmation
    if (event === 'confirmation' && prefs.confirmationChime !== undefined) {
      return {
        enabled: prefs.confirmationChime,
        sound: prefs.soundType || 'chime',
      };
    }

    // Use defaults
    return DEFAULT_EVENT_SOUNDS[event];
  }, [user?.preferences?.notificationSounds]);

  /**
   * Play sound for a specific event
   */
  const playEventSound = useCallback((event: SoundEvent) => {
    const prefs = user?.preferences?.notificationSounds;
    if (!prefs?.enabled) return;

    const config = getEventConfig(event);
    if (config.enabled && config.sound !== 'none') {
      const volume = prefs.volume ?? 50;
      playSound(config.sound, volume);
    }
  }, [user?.preferences?.notificationSounds, getEventConfig, playSound]);

  /**
   * Play the configured confirmation chime (legacy method for backwards compatibility)
   */
  const playConfirmationChime = useCallback(() => {
    playEventSound('confirmation');
  }, [playEventSound]);

  /**
   * Check if notification sounds are enabled
   */
  const isSoundEnabled = useCallback(() => {
    const prefs = user?.preferences?.notificationSounds;
    return prefs?.enabled ?? false;
  }, [user?.preferences?.notificationSounds]);

  return {
    playConfirmationChime,
    playEventSound,
    playSound,
    isSoundEnabled,
    getEventConfig,
    soundPresets: getSoundPresets(),
    soundEvents: SOUND_EVENTS,
  };
}
