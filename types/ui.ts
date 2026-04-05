/**
 * UI & Theme Types
 *
 * Theme options, background options, notification sounds,
 * table column configuration, and related UI types.
 */

export type BackgroundOption =
  // Static backgrounds
  | 'minimal'
  | 'zen'
  | 'circuit'
  | 'topography'
  | 'waves'
  | 'lines'
  | 'sanctuary'
  | 'sanctuary-hero'
  | 'hexagons'
  | 'triangles'
  | 'stars'
  | 'aurora'
  | 'dots'
  | 'cross'
  | 'mountains'
  | 'noise'
  // Bitcoin themed
  | 'sakura-petals'
  | 'floating-shields'
  | 'bitcoin-particles'
  | 'stacking-blocks'
  | 'digital-rain'
  | 'constellation'
  | 'sanctuary-logo'
  | 'sats-symbol'
  | 'hash-storm'
  // Weather
  | 'snowfall'
  | 'fireflies'
  | 'gentle-rain'
  | 'northern-lights'
  | 'thunderstorm'
  | 'ice-crystals'
  | 'raindrop-window'
  // Nature
  | 'ink-drops'
  | 'rippling-water'
  | 'falling-leaves'
  | 'embers-rising'
  | 'butterfly-garden'
  | 'dandelion-wishes'
  | 'lavender-fields'
  | 'serene-meadows'
  | 'autumn-wind'
  // Sumi-e / Zen
  | 'brush-stroke-blossoms'
  | 'ink-branch'
  | 'calligraphy-wind'
  | 'mountain-mist'
  | 'koi-shadows'
  | 'bamboo-sway'
  | 'ink-on-water'
  | 'enso-circles'
  | 'zen-sand-garden'
  | 'smoke-calligraphy'
  | 'breath'
  | 'sakura-redux'
  // Water
  | 'gentle-waves'
  | 'tide-pools'
  | 'bioluminescent-beach'
  | 'tidal-patterns'
  | 'jellyfish-drift'
  // Sky
  | 'stargazing'
  | 'moonlit-clouds'
  | 'eclipse'
  | 'fireworks'
  // Landscape
  | 'misty-valley'
  | 'desert-dunes'
  | 'volcanic-islands'
  | 'still-ponds'
  // Creatures
  | 'duckling-parade'
  | 'bunny-meadow'
  // Whimsical
  | 'floating-lanterns'
  | 'paper-boats'
  | 'paper-airplanes'
  | 'wind-chimes'
  | 'lotus-bloom'
  | 'sunset-sailing'
  | 'train-station'
  // Organic
  | 'mycelium-network'
  | 'oil-slick'
  | 'wisteria';

export type ThemeOption =
  | 'sanctuary'
  | 'serenity'
  | 'forest'
  | 'cyber'
  | 'sunrise'
  | 'ocean'
  | 'sunset'
  | 'sakura-yoshino'
  | 'sakura-sumie'
  | 'midnight'
  | 'bamboo'
  | 'copper'
  | 'desert'
  | 'seasonal';

export type SoundType = 'chime' | 'bell' | 'coin' | 'success' | 'gentle' | 'zen' | 'ping' | 'pop' | 'harp' | 'retro' | 'marimba' | 'glass' | 'synth' | 'drop' | 'sparkle' | 'drums' | 'whistle' | 'brass' | 'windchime' | 'click' | 'none';

export interface EventSoundConfig {
  enabled: boolean;
  sound: SoundType;
}

export interface NotificationSounds {
  enabled: boolean;
  volume: number; // 0-100
  // Per-event sound configuration
  confirmation?: EventSoundConfig; // Transaction confirmed
  receive?: EventSoundConfig;      // Bitcoin received
  send?: EventSoundConfig;         // Transaction broadcast
  // Legacy fields for backwards compatibility
  confirmationChime?: boolean;
  soundType?: SoundType;
}

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
  notifyDraft: boolean;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export interface WalletAutopilotSettings {
  enabled: boolean;
  maxFeeRate: number;
  minUtxoCount: number;
  dustThreshold: number;
  cooldownHours: number;
  notifyTelegram: boolean;
  notifyPush: boolean;
  minDustCount: number;
  maxUtxoSize: number;
}

export interface UtxoHealthStatus {
  totalUtxos: number;
  dustCount: number;
  dustValue: string;      // BigInt serialized as string
  totalValue: string;
  avgUtxoSize: string;
  smallestUtxo: string;
  largestUtxo: string;
  consolidationCandidates: number;
}

export interface FeeSnapshot {
  timestamp: number;
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
}

export interface AutopilotStatus {
  utxoHealth: UtxoHealthStatus;
  feeSnapshot: FeeSnapshot | null;
  settings: WalletAutopilotSettings;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  sortable?: boolean;
  sortKey?: string;
  defaultVisible?: boolean;
  required?: boolean;        // Cannot be hidden (e.g., name column)
  align?: 'left' | 'center' | 'right';
}

export type WalletColumnId = 'name' | 'type' | 'devices' | 'sync' | 'pending' | 'balance';

export type DeviceColumnId = 'label' | 'type' | 'fingerprint' | 'accounts' | 'wallets' | 'actions';

export interface SeasonalBackgrounds {
  spring?: BackgroundOption;
  summer?: BackgroundOption;
  fall?: BackgroundOption;
  winter?: BackgroundOption;
}
