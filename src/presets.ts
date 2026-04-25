import type { BanRiskLevel } from './health.js';

export interface ResolvedConfig {
  // Rate limits
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  minDelayMs: number;
  maxDelayMs: number;
  newChatDelayMs: number;
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
}

export type PresetName = 'conservative' | 'moderate' | 'aggressive';

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
    warmupDays: 10,
    day1Limit: 15,
    growthFactor: 1.8,
    inactivityThresholdHours: 72,
    autoPauseAt: 'medium',
    groupMultiplier: 0.5,
    groupProfiles: false,
    logging: true,
  },
  moderate: {
    maxPerMinute: 10,
    maxPerHour: 300,
    maxPerDay: 1500,
    minDelayMs: 1500,
    maxDelayMs: 5000,
    newChatDelayMs: 3000,
    warmupDays: 7,
    day1Limit: 20,
    growthFactor: 1.8,
    inactivityThresholdHours: 72,
    autoPauseAt: 'high',
    groupMultiplier: 0.7,
    groupProfiles: false,
    logging: true,
  },
  aggressive: {
    maxPerMinute: 20,
    maxPerHour: 800,
    maxPerDay: 4000,
    minDelayMs: 800,
    maxDelayMs: 3000,
    newChatDelayMs: 2000,
    warmupDays: 4,
    day1Limit: 35,
    growthFactor: 2.0,
    inactivityThresholdHours: 48,
    autoPauseAt: 'critical',
    groupMultiplier: 0.9,
    groupProfiles: false,
    logging: true,
  },
};

export function resolveConfig(input: AntiBanInput): ResolvedConfig {
  if (input === undefined) {
    return { ...PRESETS.conservative };
  }

  if (typeof input === 'string') {
    if (!(input in PRESETS)) {
      throw new Error(`Unknown preset "${input}". Valid: ${Object.keys(PRESETS).join(', ')}`);
    }
    return { ...PRESETS[input] };
  }

  // Object form — extract preset base, merge overrides
  const { preset = 'conservative', ...overrides } = input;
  if (!(preset in PRESETS)) {
    throw new Error(`Unknown preset "${preset}". Valid: ${Object.keys(PRESETS).join(', ')}`);
  }
  return { ...PRESETS[preset], ...overrides };
}
