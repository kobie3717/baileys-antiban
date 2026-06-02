import type { BanRiskLevel, HealthStatus } from './health.js';
import type { TimelockState } from './timelockGuard.js';

export interface ResolvedConfig {
  // Rate limits
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  minDelayMs: number;
  maxDelayMs: number;
  newChatDelayMs: number;
  maxIdenticalMessages: number;
  identicalMessageWindowMs: number;
  burstAllowance: number;
  // Warmup
  warmupDays: number;
  day1Limit: number;
  growthFactor: number;
  inactivityThresholdHours: number;
  // Health
  autoPauseAt: BanRiskLevel;
  // Group profiles
  groupMultiplier: number;
  groupProfiles: boolean;
  // Persistence
  persist?: string;
  // Logging
  logging: boolean;
  // Instance coordination (cross-process rate pooling)
  instanceCoordinator?: string;           // Path to shared coordination file
  instancePoolMaxPerMinute?: number;      // Per-minute limit across all instances (default: 20)
  instancePoolMaxPerHour?: number;        // Per-hour limit across all instances (default: 500)
  // Callbacks (flat — no nested config required)
  onAtRisk?: (status: HealthStatus) => void;
  onRiskChange?: (status: HealthStatus) => void;         // ADD: fires on ALL risk level changes
  onTimelockDetected?: (state: TimelockState) => void;   // ADD: fires when timelock detected
  onTimelockLifted?: (state: TimelockState) => void;     // ADD: fires when timelock lifts
}

export type PresetName = 'conservative' | 'moderate' | 'aggressive' | 'high-volume';

export type AntiBanInput =
  | PresetName
  | Partial<ResolvedConfig & { preset?: PresetName }>
  | undefined;

export const PRESETS: Record<PresetName, ResolvedConfig> = {
  conservative: {
    maxPerMinute: 5,
    maxPerHour: 100,
    maxPerDay: 800,
    minDelayMs: 2500,
    maxDelayMs: 7000,
    newChatDelayMs: 4000,
    maxIdenticalMessages: 3,
    identicalMessageWindowMs: 3600000,
    burstAllowance: 3,
    warmupDays: 10,
    day1Limit: 15,
    growthFactor: 1.8,
    inactivityThresholdHours: 72,
    autoPauseAt: 'medium',
    groupMultiplier: 0.5,
    groupProfiles: true,
    logging: true,
  },
  moderate: {
    maxPerMinute: 10,
    maxPerHour: 300,
    maxPerDay: 1500,
    minDelayMs: 1500,
    maxDelayMs: 5000,
    newChatDelayMs: 3000,
    maxIdenticalMessages: 5,
    identicalMessageWindowMs: 3600000,
    burstAllowance: 5,
    warmupDays: 7,
    day1Limit: 20,
    growthFactor: 1.8,
    inactivityThresholdHours: 72,
    autoPauseAt: 'high',
    groupMultiplier: 0.7,
    groupProfiles: true,
    logging: true,
  },
  aggressive: {
    maxPerMinute: 20,
    maxPerHour: 800,
    maxPerDay: 4000,
    minDelayMs: 800,
    maxDelayMs: 3000,
    newChatDelayMs: 2000,
    maxIdenticalMessages: 10,
    identicalMessageWindowMs: 3600000,
    burstAllowance: 8,
    warmupDays: 4,
    day1Limit: 35,
    growthFactor: 2.0,
    inactivityThresholdHours: 48,
    autoPauseAt: 'high',
    groupMultiplier: 0.9,
    groupProfiles: true,
    logging: true,
  },
  // For established, fully-warmed accounts running enterprise-scale operations.
  // Only use on accounts with 6+ months history and no prior bans.
  'high-volume': {
    maxPerMinute: 40,
    maxPerHour: 1500,
    maxPerDay: 8000,
    minDelayMs: 400,
    maxDelayMs: 1800,
    newChatDelayMs: 1200,
    maxIdenticalMessages: 20,
    identicalMessageWindowMs: 3600000,
    burstAllowance: 15,
    warmupDays: 3,
    day1Limit: 60,
    growthFactor: 2.5,
    inactivityThresholdHours: 24,
    autoPauseAt: 'high',  // Pause at HIGH not CRITICAL (too late)
    groupMultiplier: 0.95,
    groupProfiles: true,
    logging: true,
  },
};

export function resolveConfig(input: AntiBanInput): ResolvedConfig {
  if (input === undefined) {
    return { ...PRESETS.conservative };
  }

  if (typeof input === 'string') {
    if (!(input in PRESETS)) {
      throw new Error(`Unknown preset "${input}". Valid: conservative, moderate, aggressive, high-volume`);
    }
    // Warn if using high-volume preset
    if (input === 'high-volume') {
      console.warn('[baileys-antiban] WARNING: high-volume preset requires an established account (6+ months). Using on new accounts will result in immediate bans. Set accountAgeDays in config to suppress this warning.');
    }
    return { ...PRESETS[input] };
  }

  // Object form — extract preset base, merge overrides
  const { preset = 'conservative', ...overrides } = input;
  if (!(preset in PRESETS)) {
    throw new Error(`Unknown preset "${preset}". Valid: conservative, moderate, aggressive, high-volume`);
  }
  // Warn if using high-volume preset (unless accountAgeDays is set)
  if (preset === 'high-volume' && !('accountAgeDays' in overrides)) {
    console.warn('[baileys-antiban] WARNING: high-volume preset requires an established account (6+ months). Using on new accounts will result in immediate bans. Set accountAgeDays in config to suppress this warning.');
  }
  return { ...PRESETS[preset], ...overrides };
}
